import { google } from "googleapis";
import { GDriveReadFileInput, InternalToolResponse } from "./types.js";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { pdfCache } from "./cache.js";
import { PDFTableExtractor } from "./pdf-table-extractor.js";
import { pdfSizeLimitMB } from "../index.js";
import * as XLSX from "xlsx";

export const schema = {
  name: "gdrive_read_file",
  description: "Read file contents from Google Drive. Supports text extraction from PDFs and structured data from Excel files (.xlsx). Automatically converts Google Docs/Sheets to readable formats. For very large files (>20MB) or partial reading, use gdrive_read_large_file instead.",
  inputSchema: {
    type: "object",
    properties: {
      fileId: {
        type: "string",
        description: "ID of the file to read",
      },
    },
    required: ["fileId"],
  },
} as const;

const drive = google.drive("v3");

interface FileContent {
  uri?: string;
  mimeType: string;
  text?: string;
  blob?: string;
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

export async function readFile(
  args: GDriveReadFileInput,
): Promise<InternalToolResponse> {
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
  const isAllowed = await isFileInAllowedScope(drive, args.fileId, rootFolderId);
  
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
  
  try {
    const result = await readGoogleDriveFile(args.fileId);
    
    // Special handling for PDF files with metadata
    if (result.contents.mimeType === "application/pdf" && result.contents.text) {
      try {
        const pdfData = JSON.parse(result.contents.text);
        let formattedText = `PDF 파일: ${result.name}\n\n`;
        
        // Add metadata section
        formattedText += `📄 메타데이터:\n`;
        formattedText += `- 페이지 수: ${pdfData.metadata.pages}\n`;
        formattedText += `- 파일 크기: ${(pdfData.metadata.fileSize / (1024 * 1024)).toFixed(2)} MB\n`;
        if (pdfData.metadata.title) formattedText += `- 제목: ${pdfData.metadata.title}\n`;
        if (pdfData.metadata.author) formattedText += `- 작성자: ${pdfData.metadata.author}\n`;
        if (pdfData.metadata.createdAt) formattedText += `- 생성일: ${pdfData.metadata.createdAt}\n`;
        if (pdfData.metadata.modifiedAt) formattedText += `- 수정일: ${pdfData.metadata.modifiedAt}\n`;
        
        // Add tables section if available
        if (pdfData.tables && pdfData.tables.length > 0) {
          formattedText += `\n📋 추출된 테이블 (${pdfData.tables.length}개):\n\n`;
          
          for (const table of pdfData.tables) {
            formattedText += `[테이블 ${table.index}]\n`;
            formattedText += table.markdown;
            formattedText += `\n`;
          }
        }
        
        formattedText += `\n📝 텍스트 내용:\n\n${pdfData.text}`;
        
        return {
          content: [
            {
              type: "text",
              text: formattedText,
            },
          ],
          isError: false,
        };
      } catch (e) {
        // If JSON parsing fails, fall back to original text
      }
    }
    
    // Special handling for Excel files with structured data
    if ((result.contents.mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || 
         result.name.toLowerCase().endsWith('.xlsx')) && result.contents.text) {
      try {
        const excelData = JSON.parse(result.contents.text);
        let formattedText = `Excel 파일: ${result.name}\n\n`;
        
        // 디버깅 정보 추가
        if (excelData.debugInfo) {
          formattedText += `🔍 ${excelData.debugInfo}\n`;
          formattedText += `📄 처리 방식: ${excelData.processedAs || 'unknown'}\n`;
          formattedText += `📌 실제 MIME: ${excelData.actualMimeType || 'unknown'}\n\n`;
        }
        
        // Add metadata section
        formattedText += `📊 메타데이터:\n`;
        formattedText += `- 시트 수: ${excelData.metadata.sheetCount}\n`;
        formattedText += `- 파일 크기: ${(excelData.metadata.fileSize / (1024 * 1024)).toFixed(2)} MB\n`;
        formattedText += `- 시트 목록: ${excelData.sheetNames.join(', ')}\n\n`;
        
        // Add data for each sheet
        for (const sheetName of excelData.sheetNames) {
          const sheet = excelData.sheets[sheetName];
          formattedText += `📋 [${sheetName}] 시트\n`;
          formattedText += `- 범위: ${sheet.range}\n`;
          formattedText += `- 행 수: ${sheet.rowCount}\n`;
          formattedText += `- 열 수: ${sheet.columnCount}\n`;
          
          if (sheet.data.length > 0) {
            formattedText += `\n데이터 (처음 10행):\n`;
            const preview = sheet.data.slice(0, 10);
            formattedText += JSON.stringify(preview, null, 2);
            
            if (sheet.data.length > 10) {
              formattedText += `\n... (총 ${sheet.data.length}행 중 10행만 표시)\n`;
            }
          }
          
          formattedText += `\n`;
        }
        
        formattedText += `\n💾 전체 데이터는 JSON 형식으로 사용 가능합니다.`;
        
        return {
          content: [
            {
              type: "text",
              text: formattedText,
            },
          ],
          isError: false,
        };
      } catch (e) {
        // If JSON parsing fails, fall back to original text
      }
    }
    
    return {
      content: [
        {
          type: "text",
          text: `Contents of ${result.name}:\n\n${result.contents.text || result.contents.blob}`,
        },
      ],
      isError: false,
    };
  } catch (error: any) {
    const errorMessage = error.message || "Unknown error";
    
    // Check if it's a size limit error
    if (errorMessage.includes("초과") || errorMessage.includes("exceeds")) {
      const fileSizeMatch = errorMessage.match(/(\d+(?:\.\d+)?)\s*MB/);
      const fileSize = fileSizeMatch ? fileSizeMatch[1] : "unknown";
      
      return {
        content: [
          {
            type: "text",
            text: `File size limit exceeded (${fileSize} MB). Use gdrive_read_large_file to read this file in chunks. Example: {"fileId": "${args.fileId}", "maxBytes": 10485760}`,
          },
        ],
        isError: true,
      };
    }
    
    // Check if it's a Google Sheets file mistakenly processed
    if (errorMessage.includes("Google Sheets") || errorMessage.includes("spreadsheet")) {
      return {
        content: [
          {
            type: "text",
            text: `This appears to be a Google Sheets file. Use gsheets_read instead of gdrive_read_file for native Google Sheets documents.`,
          },
        ],
        isError: true,
      };
    }
    
    // Excel file specific errors
    if (errorMessage.includes("Excel") || errorMessage.includes("xlsx")) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to process Excel file: ${errorMessage}. Ensure the file is a valid .xlsx format and not corrupted. If the file is too large, try gdrive_read_large_file for partial reading.`,
          },
        ],
        isError: true,
      };
    }
    
    // PDF specific errors
    if (errorMessage.includes("PDF")) {
      return {
        content: [
          {
            type: "text",
            text: `PDF processing error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
    
    // Generic error with more context
    return {
      content: [
        {
          type: "text",
          text: `Error reading file: ${errorMessage}. If this is a large file (>20MB), consider using gdrive_read_large_file instead.`,
        },
      ],
      isError: true,
    };
  }
}

async function readGoogleDriveFile(
  fileId: string,
): Promise<{ name: string; contents: FileContent }> {
  // First get file metadata to check mime type
  const file = await drive.files.get({
    fileId,
    fields: "mimeType,name,modifiedTime,size",
    supportsAllDrives: true,
  });

  // For Google Docs/Sheets/etc we need to export
  if (file.data.mimeType?.startsWith("application/vnd.google-apps")) {
    let exportMimeType: string;
    let isExportable = true;
    
    switch (file.data.mimeType) {
      case "application/vnd.google-apps.document":
        exportMimeType = "text/markdown";
        break;
      case "application/vnd.google-apps.spreadsheet":
        exportMimeType = "text/csv";
        break;
      case "application/vnd.google-apps.presentation":
        exportMimeType = "text/plain";
        break;
      case "application/vnd.google-apps.drawing":
        exportMimeType = "image/png";
        break;
      case "application/vnd.google-apps.folder":
      case "application/vnd.google-apps.form":
      case "application/vnd.google-apps.site":
      case "application/vnd.google-apps.shortcut":
      case "application/vnd.google-apps.map":
      case "application/vnd.google-apps.fusiontable":
        isExportable = false;
        exportMimeType = "";
        break;
      default:
        // Unknown Google Apps type - try as regular file
        isExportable = false;
        exportMimeType = "";
    }

    if (!isExportable) {
      throw new Error(`Cannot read this type of Google Apps file: ${file.data.mimeType}. File type is not exportable.`);
    }

    const res = await drive.files.export(
      { fileId, mimeType: exportMimeType },
      { responseType: "text" },
    );

    return {
      name: file.data.name || fileId,
      contents: {
        mimeType: exportMimeType,
        text: res.data as string,
      },
    };
  }

  const mimeType = file.data.mimeType || "application/octet-stream";
  const fileName = file.data.name || fileId;
  const isExcelFile = fileName.toLowerCase().endsWith('.xlsx');
  
  // Excel 파일 처리 - 파일 확장자 우선 확인
  const excelMimeTypes = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/octet-stream" // 일부 경우 이 MIME 타입으로 올 수 있음
  ];
  
  if (isExcelFile || (excelMimeTypes.includes(mimeType) && fileName.toLowerCase().endsWith('.xlsx'))) {
    // 디버깅 정보 포함
    const debugInfo = `[Debug] File: ${fileName}, MIME: ${mimeType}, Size: ${file.data.size} bytes`;
    
    // Excel 처리 로직으로 이동
    return await processExcelFile(fileId, file, drive, debugInfo);
  }
  
  // Handle PDF files specially with caching
  if (mimeType === "application/pdf") {
    // Generate cache key using fileId and modifiedTime
    const cacheKey = `pdf_${fileId}_${file.data.modifiedTime || 'unknown'}`;
    
    // Check cache first
    const cachedResult = pdfCache.get(cacheKey);
    if (cachedResult) {
      return {
        name: file.data.name || fileId,
        contents: {
          mimeType,
          text: JSON.stringify(cachedResult, null, 2),
        },
      };
    }
    
    // Cache miss - download and process the file
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" },
    );
    const content = Buffer.from(res.data as ArrayBuffer);
    // Check file size limit
    const fileSizeMB = content.length / (1024 * 1024);
    if (fileSizeMB > pdfSizeLimitMB) {
      const fileName = file.data.name || fileId;
      console.error(`Large PDF detected: ${fileName} (${fileSizeMB.toFixed(1)}MB) exceeds limit (${pdfSizeLimitMB}MB)`);
      
      const suggestedLimit = Math.min(Math.ceil(fileSizeMB / 10) * 10, 100);
      throw new Error(`PDF 파일이 ${pdfSizeLimitMB}MB를 초과합니다 (실제: ${fileSizeMB.toFixed(1)} MB).

대안:
1. 환경변수로 제한 늘리기:
   PDF_SIZE_LIMIT_MB=${suggestedLimit}

2. 부분 읽기 (텍스트 추출 불가):
   gdrive_read_large_file 사용
   예: { "fileId": "${fileId}", "maxBytes": 10485760 }

3. PDF 파일 압축 또는 분할 권장`);
    }
    try {
      const pdfData = await pdf(content);
      
      // Check if it's a scanned document (no text extracted)
      if (!pdfData.text || pdfData.text.trim().length === 0) {
        throw new Error("이 PDF는 스캔된 이미지로 구성되어 있어 텍스트를 추출할 수 없습니다.");
      }
      
      // Extract metadata
      const metadata: any = {
        pages: pdfData.numpages,
        fileSize: content.length,
      };
      
      // Add optional metadata fields if available
      if (pdfData.info.Title) metadata.title = pdfData.info.Title;
      if (pdfData.info.Author) metadata.author = pdfData.info.Author;
      if (pdfData.info.CreationDate) metadata.createdAt = pdfData.info.CreationDate;
      if (pdfData.info.ModDate) metadata.modifiedAt = pdfData.info.ModDate;
      if (pdfData.info.Creator) metadata.creator = pdfData.info.Creator;
      if (pdfData.info.Producer) metadata.producer = pdfData.info.Producer;
      if (pdfData.info.Subject) metadata.subject = pdfData.info.Subject;
      if (pdfData.info.Keywords) metadata.keywords = pdfData.info.Keywords;
      
      // Try to extract tables
      let tables: any[] = [];
      try {
        const tableExtractor = new PDFTableExtractor();
        const extractedTables = await tableExtractor.extractTablesFromBuffer(content);
        
        if (extractedTables.length > 0) {
          tables = extractedTables.map((table, index) => ({
            index: index + 1,
            headers: table.headers,
            rows: table.rows,
            markdown: PDFTableExtractor.tableToMarkdown(table),
            json: PDFTableExtractor.tableToJson(table)
          }));
        }
      } catch (tableError) {
        // Table extraction failed, continuing with text only
      }
      
      // Create structured response
      const pdfResponse = {
        text: pdfData.text,
        metadata: metadata,
        version: pdfData.version,
        tables: tables
      };
      
      // Store in cache
      pdfCache.set(cacheKey, pdfResponse, content.length);
      
      return {
        name: file.data.name || fileId,
        contents: {
          mimeType,
          text: JSON.stringify(pdfResponse, null, 2),
        },
      };
    } catch (error) {
      // If PDF parsing fails, provide detailed error messages
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      
      // Determine specific error type and provide user-friendly message
      let userMessage = "";
      if (errorMessage.includes("encrypt") || errorMessage.includes("password")) {
        userMessage = "이 PDF는 암호로 보호되어 있습니다.";
      } else if (errorMessage.includes("scanned")) {
        userMessage = errorMessage;
      } else {
        userMessage = `PDF 파싱 오류: ${errorMessage}`;
      }
      
      return {
        name: file.data.name || fileId,
        contents: {
          mimeType,
          blob: content.toString("base64"),
          text: userMessage,
        },
      };
    }
  }


  // For non-PDF, non-Excel regular files, download content
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  const content = Buffer.from(res.data as ArrayBuffer);
  const isText =
    mimeType.startsWith("text/") || mimeType === "application/json";

  return {
    name: file.data.name || fileId,
    contents: {
      mimeType,
      ...(isText
        ? { text: content.toString("utf-8") }
        : { blob: content.toString("base64") }),
    },
  };
}

// Excel 파일 처리 함수
async function processExcelFile(
  fileId: string, 
  file: any, 
  drive: any,
  debugInfo: string
): Promise<{ name: string; contents: FileContent }> {
  const mimeType = file.data.mimeType || "application/octet-stream";
  const cacheKey = `excel_${fileId}_${file.data.modifiedTime || 'unknown'}`;
  
  // Check cache first
  const cachedResult = pdfCache.get(cacheKey);
  if (cachedResult) {
    // 캐시된 결과에 디버깅 정보 추가
    const resultWithDebug = {
      debugInfo,
      ...cachedResult
    };
    return {
      name: file.data.name || fileId,
      contents: {
        mimeType,
        text: JSON.stringify(resultWithDebug, null, 2),
      },
    };
  }
  
  // Cache miss - download and process the file
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  const content = Buffer.from(res.data as ArrayBuffer);
  
  // Check file size limit (using same limit as PDF for consistency)
  const fileSizeMB = content.length / (1024 * 1024);
  if (fileSizeMB > pdfSizeLimitMB) {
    const fileName = file.data.name || fileId;
    
    const suggestedLimit = Math.min(Math.ceil(fileSizeMB / 10) * 10, 100);
    throw new Error(`Excel 파일이 ${pdfSizeLimitMB}MB를 초과합니다 (실제: ${fileSizeMB.toFixed(1)} MB).

대안:
1. 환경변수로 제한 늘리기:
   PDF_SIZE_LIMIT_MB=${suggestedLimit}

2. 부분 읽기:
   gdrive_read_large_file 사용
   예: { "fileId": "${fileId}", "maxBytes": 10485760 }

3. Excel 파일 분할 또는 불필요한 시트 제거 권장`);
  }
  
  try {
    // Read Excel file
    const workbook = XLSX.read(content, { 
      type: 'buffer',
      cellDates: true,
      cellNF: false,
      cellText: false
    });
    
    // Prepare structured response with debug info
    const excelResponse: any = {
      debugInfo,
      processedAs: 'excel',
      actualMimeType: mimeType,
      sheetNames: workbook.SheetNames,
      sheets: {},
      metadata: {
        fileSize: content.length,
        sheetCount: workbook.SheetNames.length,
      }
    };
    
    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to different formats
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      const csvData = XLSX.utils.sheet_to_csv(worksheet);
      
      // Get sheet range
      const range = worksheet['!ref'] || 'A1';
      
      // Extract headers (first row)
      const headers: any[] = jsonData.length > 0 ? jsonData[0] as any[] : [];
      
      // Convert to structured format with headers
      const structuredData = jsonData.slice(1).map((row: any) => {
        const obj: any = {};
        headers.forEach((header: any, index: number) => {
          obj[header || `Column${index + 1}`] = row[index] || null;
        });
        return obj;
      });
      
      excelResponse.sheets[sheetName] = {
        range: range,
        rowCount: jsonData.length,
        columnCount: headers.length,
        headers: headers,
        data: structuredData,
        rawData: jsonData,
        csv: csvData
      };
    }
    
    // Store in cache
    pdfCache.set(cacheKey, excelResponse, content.length);
    
    return {
      name: file.data.name || fileId,
      contents: {
        mimeType,
        text: JSON.stringify(excelResponse, null, 2),
      },
    };
  } catch (error) {
    // If Excel parsing fails, return as binary blob with detailed error message
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    return {
      name: file.data.name || fileId,
      contents: {
        mimeType,
        blob: content.toString("base64"),
        text: `Excel 파싱 오류: ${errorMessage}
        
디버그 정보: ${debugInfo}
MIME 타입 불일치일 수 있습니다. 파일이 실제로 .xlsx 형식인지 확인해주세요.`,
      },
    };
  }
}

