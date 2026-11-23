import { uploadFileToStorage } from './storageService';
import { settingsService } from './settingsService';
import { CompanySettings } from '../types';

export async function storageServiceUploadLogo(
  file: File
): Promise<CompanySettings> {
  const uploaded = await uploadFileToStorage('company-assets', file);
  return await settingsService.updateSettings({
    logoFileId: uploaded.fileId,
  });
}
