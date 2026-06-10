const fs = require("fs");
const path = require("path");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

class PDFProcessor {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async validatePDF(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { valid: false, error: "file not found" };
      }

      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        return { valid: false, error: "file is empty" };
      }

      const buffer = fs.readFileSync(filePath);
      const header = buffer.slice(0, 5).toString();

      if (!header.startsWith("%PDF")) {
        return { valid: false, error: "not a valid PDF file" };
      }

      try {
        await PDFDocument.load(buffer);
      } catch (error) {
        return { valid: false, error: `corrupted PDF: ${error.message}` };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async addWatermark(filePath, passenger, airline) {
    try {
      this.logger.info("adding watermark to PDF", { file: filePath });

      const existingPdfBytes = fs.readFileSync(filePath);
      const pdfDoc = await PDFDocument.load(existingPdfBytes);

      const watermarkConfig = this.config.get("pdf.watermark");

      if (!watermarkConfig.enabled) {
        this.logger.info("watermark disabled, skipping");
        return filePath;
      }

      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { width, height } = firstPage.getSize();

      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontSize = watermarkConfig.fontSize;
      const color = rgb(
        watermarkConfig.color.r,
        watermarkConfig.color.g,
        watermarkConfig.color.b
      );

      const now = new Date();
      const dateStr = now.toLocaleDateString("es-CO", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      });
      const timeStr = now.toLocaleTimeString("es-CO", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });

      const lines = [
        `✓ ${watermarkConfig.text}`,
        `Aerolínea: ${airline.toUpperCase()}`,
        `Fecha: ${dateStr} ${timeStr}`,
        `Pasajero: ${passenger.first_name} ${passenger.last_name}`,
        `Sistema Automatizado`
      ];

      const lineHeight = fontSize + 4;
      const startY = height - watermarkConfig.position.y;
      const startX = watermarkConfig.position.x;

      for (let i = 0; i < lines.length; i++) {
        firstPage.drawText(lines[i], {
          x: startX,
          y: startY - i * lineHeight,
          size: fontSize,
          font: font,
          color: color
        });
      }

      const boxHeight = lines.length * lineHeight + 10;
      const boxWidth = 350;

      firstPage.drawRectangle({
        x: startX - 5,
        y: startY - boxHeight + lineHeight - 5,
        width: boxWidth,
        height: boxHeight,
        borderColor: color,
        borderWidth: 1.5,
        opacity: 0
      });

      const modifiedPdfBytes = await pdfDoc.save();
      fs.writeFileSync(filePath, modifiedPdfBytes);

      this.logger.info("watermark added successfully", {
        file: path.basename(filePath),
        airline: airline
      });

      return filePath;
    } catch (error) {
      throw new Error(`adding watermark to ${filePath}: ${error.message}`);
    }
  }

  async process(filePath, passenger, airline) {
    try {
      const validation = await this.validatePDF(filePath);
      if (!validation.valid) {
        throw new Error(`invalid PDF: ${validation.error}`);
      }

      if (this.config.get("pdf.backup")) {
        await this.createBackup(filePath);
      }

      await this.addWatermark(filePath, passenger, airline);

      return filePath;
    } catch (error) {
      throw new Error(`processing PDF: ${error.message}`);
    }
  }

  async createBackup(filePath) {
    try {
      const backupPath = filePath.replace(".pdf", ".original.pdf");
      fs.copyFileSync(filePath, backupPath);

      this.logger.info("PDF backup created", { backup: backupPath });

      return backupPath;
    } catch (error) {
      this.logger.warn("creating PDF backup", { error: error.message });
      return null;
    }
  }

  generatePDFPath(passenger, airline) {
    const boardingPassDir = path.join(
      __dirname,
      "../boarding_passes",
      airline.toLowerCase()
    );

    if (!fs.existsSync(boardingPassDir)) {
      fs.mkdirSync(boardingPassDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `${passenger.reservation_code}_${passenger.last_name}_${passenger.first_name}_${timestamp}.pdf`;
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9_.-]/g, "_");

    return path.join(boardingPassDir, sanitizedFilename);
  }
}

module.exports = PDFProcessor;
