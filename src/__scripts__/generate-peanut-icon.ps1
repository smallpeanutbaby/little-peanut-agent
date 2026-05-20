$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$resourcesDir = Join-Path $root "resources"
New-Item -ItemType Directory -Force -Path $resourcesDir | Out-Null

function New-PeanutBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(42, 70, 33, 10))
  $g.FillEllipse(
    $shadowBrush,
    [float]($size * 0.24),
    [float]($size * 0.76),
    [float]($size * 0.52),
    [float]($size * 0.1)
  )
  $shadowBrush.Dispose()

  $body = New-Object System.Drawing.Drawing2D.GraphicsPath
  $body.AddBezier(
    [float]($size * 0.50), [float]($size * 0.08),
    [float]($size * 0.22), [float]($size * 0.10),
    [float]($size * 0.12), [float]($size * 0.34),
    [float]($size * 0.22), [float]($size * 0.52)
  )
  $body.AddBezier(
    [float]($size * 0.22), [float]($size * 0.52),
    [float]($size * 0.10), [float]($size * 0.74),
    [float]($size * 0.26), [float]($size * 0.93),
    [float]($size * 0.50), [float]($size * 0.88)
  )
  $body.AddBezier(
    [float]($size * 0.50), [float]($size * 0.88),
    [float]($size * 0.74), [float]($size * 0.93),
    [float]($size * 0.90), [float]($size * 0.74),
    [float]($size * 0.78), [float]($size * 0.52)
  )
  $body.AddBezier(
    [float]($size * 0.78), [float]($size * 0.52),
    [float]($size * 0.88), [float]($size * 0.34),
    [float]($size * 0.78), [float]($size * 0.10),
    [float]($size * 0.50), [float]($size * 0.08)
  )
  $body.CloseFigure()

  $fillBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.PointF([float]($size * 0.20), [float]($size * 0.10))),
    (New-Object System.Drawing.PointF([float]($size * 0.82), [float]($size * 0.92))),
    ([System.Drawing.Color]::FromArgb(255, 214, 151, 82)),
    ([System.Drawing.Color]::FromArgb(255, 147, 84, 34))
  )
  $g.FillPath($fillBrush, $body)

  $edgePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 108, 61, 23), [float][Math]::Max(2, $size * 0.028))
  $g.DrawPath($edgePen, $body)

  $groovePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(175, 102, 56, 20), [float][Math]::Max(2, $size * 0.016))
  $groovePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $groovePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawCurve(
    $groovePen,
    @(
      (New-Object System.Drawing.PointF([float]($size * 0.50), [float]($size * 0.16))),
      (New-Object System.Drawing.PointF([float]($size * 0.47), [float]($size * 0.33))),
      (New-Object System.Drawing.PointF([float]($size * 0.48), [float]($size * 0.50))),
      (New-Object System.Drawing.PointF([float]($size * 0.52), [float]($size * 0.68))),
      (New-Object System.Drawing.PointF([float]($size * 0.50), [float]($size * 0.82)))
    )
  )

  $speckBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 105, 61, 24))
  foreach ($dot in @(
    @(0.34, 0.28, 0.035, 0.024),
    @(0.68, 0.30, 0.03, 0.022),
    @(0.29, 0.49, 0.026, 0.02),
    @(0.71, 0.56, 0.032, 0.024),
    @(0.40, 0.71, 0.024, 0.018),
    @(0.60, 0.76, 0.022, 0.016)
  )) {
    $g.FillEllipse(
      $speckBrush,
      [float]($size * $dot[0]),
      [float]($size * $dot[1]),
      [float]($size * $dot[2]),
      [float]($size * $dot[3])
    )
  }

  $highlightBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(92, 255, 236, 205))
  $g.FillEllipse(
    $highlightBrush,
    [float]($size * 0.28),
    [float]($size * 0.18),
    [float]($size * 0.16),
    [float]($size * 0.26)
  )
  $g.FillEllipse(
    $highlightBrush,
    [float]($size * 0.58),
    [float]($size * 0.25),
    [float]($size * 0.10),
    [float]($size * 0.18)
  )

  $warmCoreBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(38, 255, 213, 152))
  $g.FillEllipse(
    $warmCoreBrush,
    [float]($size * 0.28),
    [float]($size * 0.22),
    [float]($size * 0.44),
    [float]($size * 0.52)
  )

  $warmCoreBrush.Dispose()
  $highlightBrush.Dispose()
  $speckBrush.Dispose()
  $groovePen.Dispose()
  $edgePen.Dispose()
  $fillBrush.Dispose()
  $body.Dispose()
  $g.Dispose()
  return $bmp
}

Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.IO;

public static class IconWriter {
  public static void SaveMultiIcon(string path, Bitmap[] bitmaps) {
    using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write))
    using (var bw = new BinaryWriter(fs)) {
      bw.Write((ushort)0);
      bw.Write((ushort)1);
      bw.Write((ushort)bitmaps.Length);
      int offset = 6 + (16 * bitmaps.Length);
      byte[][] pngs = new byte[bitmaps.Length][];
      for (int i = 0; i < bitmaps.Length; i++) {
        using (var ms = new MemoryStream()) {
          bitmaps[i].Save(ms, System.Drawing.Imaging.ImageFormat.Png);
          pngs[i] = ms.ToArray();
        }
      }
      for (int i = 0; i < bitmaps.Length; i++) {
        int size = bitmaps[i].Width;
        bw.Write((byte)(size >= 256 ? 0 : size));
        bw.Write((byte)(size >= 256 ? 0 : size));
        bw.Write((byte)0);
        bw.Write((byte)0);
        bw.Write((ushort)1);
        bw.Write((ushort)32);
        bw.Write((uint)pngs[i].Length);
        bw.Write((uint)offset);
        offset += pngs[i].Length;
      }
      for (int i = 0; i < bitmaps.Length; i++) {
        bw.Write(pngs[i]);
      }
    }
  }
}
"@ -ReferencedAssemblies System.Drawing

$png256 = Join-Path $resourcesDir "icon.png"
$bmp256 = New-PeanutBitmap 256
$bmp256.Save($png256, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp256.Dispose()

$png512 = Join-Path $resourcesDir "icon-512.png"
$bmp512 = New-PeanutBitmap 512
$bmp512.Save($png512, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp512.Dispose()

$ico = Join-Path $resourcesDir "icon.ico"
$bitmaps = New-Object "System.Collections.Generic.List[System.Drawing.Bitmap]"
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
  $bitmaps.Add((New-PeanutBitmap $size))
}
[IconWriter]::SaveMultiIcon($ico, $bitmaps.ToArray())
foreach ($bmp in $bitmaps) {
  $bmp.Dispose()
}

Get-ChildItem $resourcesDir -File | Select-Object Name, Length, LastWriteTime
