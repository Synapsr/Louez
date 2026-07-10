export const MAX_IMAGE_FILE_SIZE = 2 * 1024 * 1024;

export type ImageFileIssue = 'invalidType' | 'tooLarge';

export function getImageFileIssue(file: File): ImageFileIssue | null {
  if (!file.type.startsWith('image/')) {
    return 'invalidType';
  }
  if (file.size > MAX_IMAGE_FILE_SIZE) {
    return 'tooLarge';
  }
  return null;
}

export async function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
