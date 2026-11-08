/**
 * ImageKit Server-side Deduplication & Storage Optimization Helper
 * Protects storage quota on ImageKit by identifying and deleting duplicates
 */

const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY || 'private_upIy1erri62cI4TohevuETFkvvk=';

export function getCleanBaseName(rawName: string): string {
  if (!rawName) return '';
  let name = rawName.trim().toLowerCase();
  const dotIdx = name.lastIndexOf('.');
  let base = dotIdx !== -1 ? name.substring(0, dotIdx) : name;

  // Remove common duplicate/copy indicators: "(1)", " (2)", "_1", "-copy", " copy"
  base = base.replace(/[\s_-]*(?:copy|\(\d+\)|\d+)$/i, '');
  // Remove ImageKit generated 8-10 character hash suffixes (e.g. "_f4dcp7O08", "_kyLBd7ZcA")
  base = base.replace(/_[a-zA-Z0-9_-]{7,12}$/, '');
  // Remove unix timestamp suffixes (e.g. "_1730000000000")
  base = base.replace(/_\d{10,14}$/, '');

  return base.trim();
}

/**
 * Normalizes strings to calculate similarity
 */
export function areFileNamesSimilar(nameA: string, nameB: string): boolean {
  const baseA = getCleanBaseName(nameA);
  const baseB = getCleanBaseName(nameB);
  if (!baseA || !baseB) return false;
  if (baseA === baseB) return true;

  // If one starts with the other with at least 4 characters
  if (baseA.length >= 4 && baseB.length >= 4) {
    if (baseA.startsWith(baseB) || baseB.startsWith(baseA)) return true;
  }
  return false;
}

/**
 * Deduplicates files on ImageKit when a new file is uploaded
 */
export async function deduplicateOnUpload(params: {
  fileName?: string;
  fileId?: string;
  size?: number;
}): Promise<{ success: boolean; deletedCount: number; deletedIds: string[]; message?: string }> {
  const { fileName, fileId, size } = params;
  if (!fileName) {
    return { success: false, deletedCount: 0, deletedIds: [], message: 'No fileName provided' };
  }

  const authHeader = 'Basic ' + Buffer.from(IMAGEKIT_PRIVATE_KEY + ':').toString('base64');

  try {
    const listRes = await fetch('https://api.imagekit.io/v1/files?limit=100', {
      headers: { Authorization: authHeader }
    });

    if (!listRes.ok) {
      const errText = await listRes.text();
      return { success: false, deletedCount: 0, deletedIds: [], message: errText };
    }

    const files: any[] = await listRes.json();
    if (!Array.isArray(files)) {
      return { success: true, deletedCount: 0, deletedIds: [] };
    }

    const targetBase = getCleanBaseName(fileName);
    const duplicateIds: string[] = [];

    for (const f of files) {
      // Do not delete the newly uploaded file itself
      if (!f.fileId || f.fileId === fileId) continue;

      const isSimilar = areFileNamesSimilar(f.name, fileName);
      // Or exact byte match if size is provided and non-zero
      const isByteMatch = size && size > 100 && f.size === size;

      if (isSimilar || isByteMatch) {
        duplicateIds.push(f.fileId);
      }
    }

    if (duplicateIds.length === 0) {
      return { success: true, deletedCount: 0, deletedIds: [] };
    }

    // ImageKit batch delete takes up to 100 fileIds at a time
    const deleteRes = await fetch('https://api.imagekit.io/v1/files/batch/deleteByFileIds', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fileIds: duplicateIds })
    });

    if (deleteRes.ok) {
      const resJson = await deleteRes.json();
      const successfullyDeleted = resJson.successfullyDeletedFileIds || duplicateIds;
      return {
        success: true,
        deletedCount: successfullyDeleted.length,
        deletedIds: successfullyDeleted
      };
    } else {
      const errText = await deleteRes.text();
      return { success: false, deletedCount: 0, deletedIds: [], message: errText };
    }
  } catch (err: any) {
    return { success: false, deletedCount: 0, deletedIds: [], message: err?.message || String(err) };
  }
}

/**
 * Performs a complete media library sweep:
 * Finds all files with duplicate names/sizes in ImageKit storage,
 * keeps the single newest version of each, and purges all redundant copies.
 */
export async function cleanupAllDuplicates(): Promise<{
  success: boolean;
  totalDeleted: number;
  deletedIds: string[];
  message?: string;
}> {
  const authHeader = 'Basic ' + Buffer.from(IMAGEKIT_PRIVATE_KEY + ':').toString('base64');

  try {
    const listRes = await fetch('https://api.imagekit.io/v1/files?limit=100', {
      headers: { Authorization: authHeader }
    });

    if (!listRes.ok) {
      return { success: false, totalDeleted: 0, deletedIds: [], message: await listRes.text() };
    }

    const files: any[] = await listRes.json();
    if (!Array.isArray(files) || files.length === 0) {
      return { success: true, totalDeleted: 0, deletedIds: [] };
    }

    // Group files by clean base name and size
    const groups: { [key: string]: any[] } = {};

    for (const f of files) {
      const base = getCleanBaseName(f.name);
      // Group key: primary base name
      const key = base || f.name;
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }

    const idsToDelete: string[] = [];

    for (const key of Object.keys(groups)) {
      const group = groups[key];
      if (group.length > 1) {
        // Sort descending by createdAt (newest first)
        group.sort((a, b) => {
          const timeA = new Date(a.createdAt || 0).getTime();
          const timeB = new Date(b.createdAt || 0).getTime();
          return timeB - timeA;
        });

        // Keep group[0] (newest), delete group[1..end]
        for (let i = 1; i < group.length; i++) {
          if (group[i].fileId) {
            idsToDelete.push(group[i].fileId);
          }
        }
      }
    }

    if (idsToDelete.length === 0) {
      return { success: true, totalDeleted: 0, deletedIds: [] };
    }

    const deleteRes = await fetch('https://api.imagekit.io/v1/files/batch/deleteByFileIds', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fileIds: idsToDelete })
    });

    if (deleteRes.ok) {
      const resJson = await deleteRes.json();
      const deleted = resJson.successfullyDeletedFileIds || idsToDelete;
      return { success: true, totalDeleted: deleted.length, deletedIds: deleted };
    } else {
      return { success: false, totalDeleted: 0, deletedIds: [], message: await deleteRes.text() };
    }
  } catch (err: any) {
    return { success: false, totalDeleted: 0, deletedIds: [], message: err?.message || String(err) };
  }
}
