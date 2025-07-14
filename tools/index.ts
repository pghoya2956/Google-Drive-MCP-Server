import { schema as gdriveSearchSchema, search } from './gdrive_search.js';
import { schema as gdriveReadFileSchema, readFile } from './gdrive_read_file.js';
import { schema as gsheetsUpdateCellSchema, updateCell } from './gsheets_update_cell.js';
import { schema as gsheetsReadSchema, readSheet } from './gsheets_read.js';
import { schema as gdriveFolderStructureSchema, getFolderStructure } from './gdrive_folder_structure.js';
import { schema as gdriveReadLargeFileSchema, readLargeFile } from './gdrive_read_large_file.js';
import { schema as gdriveAnalyzeImageSchema, analyzeImage } from './gdrive_analyze_image.js';
import { 
  Tool, 
  GDriveSearchInput, 
  GDriveReadFileInput, 
  GSheetsUpdateCellInput,
  GSheetsReadInput,
  GDriveFolderStructureInput,
  GDriveReadLargeFileInput,
  GDriveAnalyzeImageInput
} from './types.js';

export const tools: [
  Tool<GDriveSearchInput>,
  Tool<GDriveReadFileInput>, 
  Tool<GSheetsUpdateCellInput>,
  Tool<GSheetsReadInput>,
  Tool<GDriveFolderStructureInput>,
  Tool<GDriveReadLargeFileInput>,
  Tool<GDriveAnalyzeImageInput>
] = [
  {
    ...gdriveSearchSchema,
    handler: search,
  },
  {
    ...gdriveReadFileSchema,
    handler: readFile,
  },
  {
    ...gsheetsUpdateCellSchema,
    handler: updateCell,
  },
  {
    ...gsheetsReadSchema,
    handler: readSheet,
  },
  {
    ...gdriveFolderStructureSchema,
    handler: getFolderStructure,
  },
  {
    ...gdriveReadLargeFileSchema,
    handler: readLargeFile,
  },
  {
    ...gdriveAnalyzeImageSchema,
    handler: analyzeImage,
  }
];