'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const DPI = 203

function mmToDots(mm) {
  return Math.max(1, Math.round((Number(mm) * DPI) / 25.4))
}

/**
 * BGRA → 1-bit packed, nearest-neighbor resize.
 * XP-235B / TSPL: bit 1 = белый (не греть), bit 0 = чёрный (печать).
 * Поэтому тёмные пиксели = 0, светлые = 1 (инверсия относительно «обычного» bitmap).
 */
function bgraToMonoPacked(bgra, srcWidth, srcHeight, dstWidth, dstHeight, threshold = 160) {
  const width = Math.max(1, dstWidth || srcWidth)
  const height = Math.max(1, dstHeight || srcHeight)
  const rowBytes = Math.ceil(width / 8)
  const out = Buffer.alloc(rowBytes * height, 0xff) // всё белое по умолчанию
  for (let y = 0; y < height; y++) {
    const sy = Math.min(srcHeight - 1, Math.floor((y * srcHeight) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(srcWidth - 1, Math.floor((x * srcWidth) / width))
      const i = (sy * srcWidth + sx) * 4
      const b = bgra[i]
      const g = bgra[i + 1]
      const r = bgra[i + 2]
      const luma = (r * 77 + g * 150 + b * 29) >> 8
      // Тёмный текст/штрихкод → сбрасываем бит (чёрная точка на термоленте)
      if (luma < threshold) {
        const byteIndex = y * rowBytes + (x >> 3)
        out[byteIndex] &= ~(0x80 >> (x & 7))
      }
    }
  }
  return { data: out, widthBytes: rowBytes, width, height }
}

/**
 * Build TSPL job: one label = SIZE + GAP + CLS + BITMAP + PRINT
 * Multiple labels = repeat BITMAP+PRINT or send separate jobs sequentially.
 */
function buildTsplBitmapJob({
  widthMm,
  heightMm,
  gapMm = 2,
  mono,
  copies = 1,
}) {
  const wDots = mmToDots(widthMm)
  const hDots = mmToDots(heightMm)

  // Crop/pad mono to exact label size in dots
  // Полярность XP-235B: 1 = белый, 0 = чёрный
  const src = mono
  const widthBytes = Math.ceil(wDots / 8)
  const packed = Buffer.alloc(widthBytes * hDots, 0xff)
  const copyW = Math.min(src.width, wDots)
  const copyH = Math.min(src.height, hDots)
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      const srcByte = y * src.widthBytes + (x >> 3)
      const bit = (src.data[srcByte] >> (7 - (x & 7))) & 1
      if (!bit) {
        const dstByte = y * widthBytes + (x >> 3)
        packed[dstByte] &= ~(0x80 >> (x & 7))
      }
    }
  }

  // SIZE must match physical label (not label+gap). PRINT 1 — один лист, без второго параметра.
  const gap = Number.isFinite(Number(gapMm)) && Number(gapMm) >= 0 ? Number(gapMm) : 2
  const header = Buffer.from(
    [
      `SIZE ${Number(widthMm)} mm,${Number(heightMm)} mm`,
      `GAP ${gap} mm,0`,
      'DIRECTION 1',
      'REFERENCE 0,0',
      'OFFSET 0 mm,0 mm',
      'DENSITY 10',
      'SPEED 3',
      'SET TEAR ON',
      'CLS',
      `BITMAP 0,0,${widthBytes},${hDots},0,`,
    ].join('\r\n'),
    'ascii',
  )
  // BITMAP: binary immediately after comma; then CRLF + PRINT once
  const n = Math.max(1, Math.min(99, Number(copies) || 1))
  const footer = Buffer.from(`\r\nPRINT ${n}\r\n`, 'ascii')
  return Buffer.concat([header, packed, footer])
}

function buildMultiLabelTspl({ widthMm, heightMm, gapMm, labelsMono }) {
  const parts = []
  for (const mono of labelsMono) {
    parts.push(buildTsplBitmapJob({ widthMm, heightMm, gapMm, mono, copies: 1 }))
  }
  return Buffer.concat(parts)
}

/**
 * Send RAW bytes to a Windows printer via Win32 WritePrinter (PowerShell).
 */
function printRawWindows(printerName, data) {
  return new Promise((resolve, reject) => {
    const name = String(printerName || '').trim()
    if (!name) {
      reject(new Error('Не выбран принтер этикеток'))
      return
    }

    const binPath = path.join(os.tmpdir(), `kakapo-tspl-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`)
    try {
      fs.writeFileSync(binPath, data)
    } catch (err) {
      reject(new Error(`Не удалось записать задание: ${err.message || err}`))
      return
    }

    const psScript = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class KakapoRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In] DOCINFOA di);
  [DllImport("winspool.drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
}
"@
$printer = ${JSON.stringify(name)}
$path = ${JSON.stringify(binPath)}
$bytes = [System.IO.File]::ReadAllBytes($path)
$hPrinter = [IntPtr]::Zero
if (-not [KakapoRawPrint]::OpenPrinter($printer, [ref]$hPrinter, [IntPtr]::Zero)) {
  throw "OpenPrinter failed for $printer (Win32 $($LASTEXITCODE))"
}
try {
  $di = New-Object KakapoRawPrint+DOCINFOA
  $di.pDocName = "KAKAPO Label"
  $di.pDataType = "RAW"
  if (-not [KakapoRawPrint]::StartDocPrinter($hPrinter, 1, $di)) { throw "StartDocPrinter failed" }
  try {
    if (-not [KakapoRawPrint]::StartPagePrinter($hPrinter)) { throw "StartPagePrinter failed" }
    try {
      $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
      try {
        [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
        $written = 0
        if (-not [KakapoRawPrint]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref]$written)) {
          throw "WritePrinter failed"
        }
      } finally {
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
      }
    } finally {
      [void][KakapoRawPrint]::EndPagePrinter($hPrinter)
    }
  } finally {
    [void][KakapoRawPrint]::EndDocPrinter($hPrinter)
  }
} finally {
  [void][KakapoRawPrint]::ClosePrinter($hPrinter)
}
Write-Output "OK"
`

    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', psScript,
    ], { windowsHide: true })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', err => {
      try { fs.unlinkSync(binPath) } catch { /* ignore */ }
      reject(err)
    })
    child.on('close', code => {
      try { fs.unlinkSync(binPath) } catch { /* ignore */ }
      if (code === 0 && /OK/.test(stdout)) {
        resolve({ ok: true, printerName: name })
        return
      }
      reject(new Error(stderr.trim() || stdout.trim() || `RAW печать ошибка (код ${code})`))
    })
  })
}

module.exports = {
  DPI,
  mmToDots,
  bgraToMonoPacked,
  buildTsplBitmapJob,
  buildMultiLabelTspl,
  printRawWindows,
}
