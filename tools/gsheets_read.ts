import { google } from "googleapis";
import { GSheetsReadInput, InternalToolResponse } from "./types.js";

export const schema = {
  name: "gsheets_read",
  description:
    "Read data from a Google Spreadsheet with flexible options for ranges and formatting",
  inputSchema: {
    type: "object",
    properties: {
      spreadsheetId: {
        type: "string",
        description: "The ID of the spreadsheet to read",
      },
      ranges: {
        type: "array",
        items: {
          type: "string",
        },
        description:
          "Optional array of A1 notation ranges like ['Sheet1!A1:B10']. If not provided, reads entire sheet.",
      },
      sheetId: {
        type: "number",
        description:
          "Optional specific sheet ID to read. If not provided with ranges, reads first sheet.",
      },
    },
    required: ["spreadsheetId"],
  },
} as const;

const sheets = google.sheets("v4");

interface CellData {
  value: any;
  location: string;
}

interface ProcessedSheetData {
  sheetName: string;
  data: CellData[][];
  totalRows?: number;
  totalColumns?: number;
  columnHeaders?: CellData[];
}

function getA1Notation(row: number, col: number): string {
  let a1 = "";

  while (col > 0) {
    col--;
    a1 = String.fromCharCode(65 + (col % 26)) + a1;
    col = Math.floor(col / 26);
  }

  return `${a1}${row + 1}`;
}

async function processSheetData(response: any): Promise<ProcessedSheetData[]> {
  const results: ProcessedSheetData[] = [];

  // Handle both single and multiple ranges
  const valueRanges = response.data.valueRanges || [response.data];

  for (const range of valueRanges) {
    const values = range.values || [];
    if (values.length === 0) continue;

    // Extract sheet name from range
    const rangeParts = range.range?.split("!") || [];
    const sheetName = rangeParts[0]?.replace(/'/g, "") || "Sheet1";

    // Process data with cell locations
    const processedValues = values.map((row: any[], rowIndex: number) =>
      row.map((cell: any, colIndex: number) => ({
        value: cell,
        location: `${sheetName}!${getA1Notation(rowIndex, colIndex + 1)}`,
      })),
    );

    // Process headers with locations
    const columnHeaders = processedValues[0];
    const data = processedValues.slice(1);

    results.push({
      sheetName,
      data,
      totalRows: values.length,
      totalColumns: columnHeaders.length,
      columnHeaders,
    });
  }

  return results;
}

// Helper function to check if a file is within the allowed folder hierarchy
async function isFileInAllowedScope(drive: any, fileId: string, rootFolderId: string): Promise<boolean> {
  let currentFileId = fileId;
  const checkedIds = new Set<string>();
  
  // Traverse up the parent hierarchy to see if we reach the root folder
  while (currentFileId && !checkedIds.has(currentFileId)) {
    checkedIds.add(currentFileId);
    
    try {
      const file = await drive.files.get({
        fileId: currentFileId,
        fields: 'id,parents',
        supportsAllDrives: true
      });
      
      // Check if this is the root folder
      if (file.data.id === rootFolderId) {
        return true;
      }
      
      // Check parents
      if (file.data.parents && file.data.parents.length > 0) {
        for (const parentId of file.data.parents) {
          if (parentId === rootFolderId) {
            return true;
          }
        }
        // Continue checking with the first parent
        currentFileId = file.data.parents[0];
      } else {
        // No parents, we've reached the top
        break;
      }
    } catch (error) {
      console.error(`Error checking file scope for ${currentFileId}:`, error);
      break;
    }
  }
  
  return false;
}

export async function readSheet(
  args: GSheetsReadInput,
): Promise<InternalToolResponse> {
  try {
    // Check environment variable
    const rootFolderId = process.env.GDRIVE_ROOT_FOLDER_ID;
    if (!rootFolderId) {
      return {
        content: [
          {
            type: "text",
            text: "Error: GDRIVE_ROOT_FOLDER_ID environment variable is required",
          },
        ],
        isError: true,
      };
    }
    
    // Check if file is in allowed scope
    const drive = google.drive("v3");
    const isAllowed = await isFileInAllowedScope(drive, args.spreadsheetId, rootFolderId);
    
    if (!isAllowed) {
      return {
        content: [
          {
            type: "text",
            text: "Error: This file is outside the allowed folder scope",
          },
        ],
        isError: true,
      };
    }
    
    let response;

    if (args.ranges) {
      // Read specific ranges
      response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: args.spreadsheetId,
        ranges: args.ranges,
      });
    } else if (args.sheetId !== undefined) {
      // Get sheet name from sheet ID first
      const metadata = await sheets.spreadsheets.get({
        spreadsheetId: args.spreadsheetId,
        fields: "sheets.properties",
      });

      const sheet = metadata.data.sheets?.find(
        (s) => s.properties?.sheetId === args.sheetId,
      );

      if (!sheet?.properties?.title) {
        throw new Error(`Sheet ID ${args.sheetId} not found`);
      }

      response = await sheets.spreadsheets.values.get({
        spreadsheetId: args.spreadsheetId,
        range: sheet.properties.title,
      });
    } else {
      // Read first sheet by default
      response = await sheets.spreadsheets.values.get({
        spreadsheetId: args.spreadsheetId,
        range: "A:ZZ", // Read all possible columns
      });
    }

    const processedData = await processSheetData(response);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(processedData, null, 2),
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error reading spreadsheet: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}
