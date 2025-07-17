import { PDFExtract, PDFExtractPage, PDFExtractText } from 'pdf.js-extract';

interface TableCell {
  text: string;
  row: number;
  col: number;
}

interface Table {
  cells: TableCell[][];
  headers: string[];
  rows: string[][];
}

export class PDFTableExtractor {
  private pdfExtract: PDFExtract;

  constructor() {
    this.pdfExtract = new PDFExtract();
  }

  async extractTablesFromBuffer(buffer: Buffer): Promise<Table[]> {
    try {
      const data = await this.pdfExtract.extractBuffer(buffer);
      const tables: Table[] = [];

      for (const page of data.pages) {
        const pageTables = this.extractTablesFromPage(page);
        tables.push(...pageTables);
      }

      return tables;
    } catch (error) {
      console.error('Error extracting tables:', error);
      return [];
    }
  }

  private extractTablesFromPage(page: PDFExtractPage): Table[] {
    const texts = page.content;
    
    // Group texts by their Y coordinate (rows)
    const rows = this.groupTextsByRow(texts);
    
    // Filter out non-table rows (single text elements or very few elements)
    const tableRows = rows.filter(row => row.length > 2);
    
    if (tableRows.length < 2) {
      return []; // Need at least 2 rows for a table
    }

    // Group consecutive table rows into tables
    const tables = this.groupRowsIntoTables(tableRows);
    
    return tables.map(tableData => this.createTable(tableData));
  }

  private groupTextsByRow(texts: PDFExtractText[], tolerance: number = 3): PDFExtractText[][] {
    // Sort texts by Y coordinate
    const sortedTexts = [...texts].sort((a, b) => a.y - b.y);
    
    const rows: PDFExtractText[][] = [];
    let currentRow: PDFExtractText[] = [];
    let currentY = sortedTexts[0]?.y || 0;

    for (const text of sortedTexts) {
      // Skip empty strings
      if (!text.str.trim()) continue;
      
      if (Math.abs(text.y - currentY) <= tolerance) {
        currentRow.push(text);
      } else {
        if (currentRow.length > 0) {
          // Sort row by X coordinate
          currentRow.sort((a, b) => a.x - b.x);
          rows.push(currentRow);
        }
        currentRow = [text];
        currentY = text.y;
      }
    }
    
    if (currentRow.length > 0) {
      currentRow.sort((a, b) => a.x - b.x);
      rows.push(currentRow);
    }
    
    return rows;
  }

  private groupRowsIntoTables(rows: PDFExtractText[][]): PDFExtractText[][][] {
    const tables: PDFExtractText[][][] = [];
    let currentTable: PDFExtractText[][] = [];
    
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      if (currentTable.length === 0) {
        currentTable.push(row);
      } else {
        // Check if this row aligns with the previous row (similar column positions)
        const prevRow = currentTable[currentTable.length - 1];
        if (this.rowsAlign(prevRow, row)) {
          currentTable.push(row);
        } else {
          // Start a new table
          if (currentTable.length >= 2) {
            tables.push(currentTable);
          }
          currentTable = [row];
        }
      }
    }
    
    if (currentTable.length >= 2) {
      tables.push(currentTable);
    }
    
    return tables;
  }

  private rowsAlign(row1: PDFExtractText[], row2: PDFExtractText[], tolerance: number = 20): boolean {
    // Check if rows have similar number of columns
    if (Math.abs(row1.length - row2.length) > 2) {
      return false;
    }
    
    // Check if at least 50% of columns align
    let alignedColumns = 0;
    for (const text1 of row1) {
      for (const text2 of row2) {
        if (Math.abs(text1.x - text2.x) <= tolerance) {
          alignedColumns++;
          break;
        }
      }
    }
    
    return alignedColumns >= Math.min(row1.length, row2.length) * 0.5;
  }

  private createTable(tableData: PDFExtractText[][]): Table {
    if (tableData.length === 0) {
      return { cells: [], headers: [], rows: [] };
    }

    // First row is likely headers
    const headers = tableData[0].map(text => text.str.trim());
    
    // Convert remaining rows
    const rows = tableData.slice(1).map(row => {
      const cells: string[] = [];
      let cellIndex = 0;
      
      // Map each text to the appropriate column based on X position
      for (let i = 0; i < headers.length; i++) {
        if (cellIndex < row.length && this.textBelongsToColumn(row[cellIndex], i, tableData[0])) {
          cells.push(row[cellIndex].str.trim());
          cellIndex++;
        } else {
          cells.push(''); // Empty cell
        }
      }
      
      return cells;
    });

    // Create cell matrix
    const cells: TableCell[][] = [];
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const cellRow: TableCell[] = [];
      for (let colIdx = 0; colIdx < headers.length; colIdx++) {
        cellRow.push({
          text: rows[rowIdx][colIdx],
          row: rowIdx,
          col: colIdx
        });
      }
      cells.push(cellRow);
    }

    return { cells, headers, rows };
  }

  private textBelongsToColumn(text: PDFExtractText, colIndex: number, headerRow: PDFExtractText[]): boolean {
    if (colIndex >= headerRow.length) return false;
    
    const headerX = headerRow[colIndex].x;
    const tolerance = 30; // Adjust based on typical column spacing
    
    return Math.abs(text.x - headerX) <= tolerance;
  }

  // Convert table to markdown format
  static tableToMarkdown(table: Table): string {
    if (table.headers.length === 0) return '';
    
    let markdown = '| ' + table.headers.join(' | ') + ' |\n';
    markdown += '|' + table.headers.map(() => '---').join('|') + '|\n';
    
    for (const row of table.rows) {
      markdown += '| ' + row.join(' | ') + ' |\n';
    }
    
    return markdown;
  }

  // Convert table to simple JSON format
  static tableToJson(table: Table): object[] {
    return table.rows.map(row => {
      const obj: any = {};
      table.headers.forEach((header, idx) => {
        obj[header] = row[idx];
      });
      return obj;
    });
  }
}