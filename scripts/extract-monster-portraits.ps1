param(
  [string]$Source = "apps/client/public/assets/original/source/monster-lineup-approved-alpha.png",
  [string]$OutputRoot = "apps/client/public/assets/original/monsters"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sourcePath = (Resolve-Path (Join-Path $projectRoot $Source)).Path
$outputPath = Join-Path $projectRoot $OutputRoot
$padding = 16
$definitions = @(
  @{ Id = "miremaw"; X = 24; Y = 250; Width = 580; Height = 540 },
  @{ Id = "ashwing"; X = 595; Y = 90; Width = 575; Height = 710 },
  @{ Id = "rootback"; X = 1180; Y = 90; Width = 580; Height = 715 }
)

$sourceImage = [System.Drawing.Bitmap]::new($sourcePath)
try {
  if ($sourceImage.Width -ne 1774 -or $sourceImage.Height -ne 887) {
    throw "Approved monster source dimensions changed: expected 1774x887, got $($sourceImage.Width)x$($sourceImage.Height)"
  }

  $records = [ordered]@{}
  foreach ($definition in $definitions) {
    $id = [string]$definition.Id
    $sourceRect = [System.Drawing.Rectangle]::new(
      [int]$definition.X,
      [int]$definition.Y,
      [int]$definition.Width,
      [int]$definition.Height
    )
    $unitDirectory = Join-Path $outputPath $id
    New-Item -ItemType Directory -Force -Path $unitDirectory | Out-Null
    $portraitPath = Join-Path $unitDirectory "portrait.png"

    $outputImage = [System.Drawing.Bitmap]::new(
      $sourceRect.Width + $padding * 2,
      $sourceRect.Height + $padding * 2,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($outputImage)
      try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $destinationRect = [System.Drawing.Rectangle]::new($padding, $padding, $sourceRect.Width, $sourceRect.Height)
        $graphics.DrawImage($sourceImage, $destinationRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
      } finally {
        $graphics.Dispose()
      }
      $outputImage.Save($portraitPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $outputImage.Dispose()
    }

    $inspection = [System.Drawing.Bitmap]::new($portraitPath)
    try {
      $cornerAlpha = @(
        $inspection.GetPixel(0, 0).A,
        $inspection.GetPixel($inspection.Width - 1, 0).A,
        $inspection.GetPixel(0, $inspection.Height - 1).A,
        $inspection.GetPixel($inspection.Width - 1, $inspection.Height - 1).A
      ) | Measure-Object -Maximum
      if ($cornerAlpha.Maximum -ne 0) {
        throw "${id}: transparent corner validation failed"
      }
      $records[$id] = [ordered]@{
        file = (Resolve-Path -Relative $portraitPath).Replace("\", "/").TrimStart(".", "/")
        sourceCrop = [ordered]@{ left = $sourceRect.X; top = $sourceRect.Y; width = $sourceRect.Width; height = $sourceRect.Height }
        output = [ordered]@{ width = $inspection.Width; height = $inspection.Height; channels = 4; cornerMaxAlpha = $cornerAlpha.Maximum }
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $portraitPath).Hash.ToLowerInvariant()
      }
      Write-Output "monster portrait $id $($inspection.Width)x$($inspection.Height)"
    } finally {
      $inspection.Dispose()
    }
  }

  $metadata = [ordered]@{
    schemaVersion = 1
    assetSet = "village-siege-monster-portraits-v1"
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    source = [ordered]@{
      file = $Source.Replace("\", "/")
      width = $sourceImage.Width
      height = $sourceImage.Height
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourcePath).Hash.ToLowerInvariant()
      provenance = "Original project-bound OpenAI image generation on flat magenta chroma key"
    }
    process = [ordered]@{
      script = "scripts/extract-monster-portraits.ps1"
      chromaHelper = "`$CODEX_HOME/skills/.system/imagegen/scripts/remove_chroma_key.py"
      paddingPx = $padding
    }
    portraits = $records
  }
  $metadataPath = Join-Path (Split-Path $outputPath -Parent) "monster-asset-metadata.json"
  $metadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $metadataPath -Encoding utf8
  Write-Output "metadata $metadataPath"
} finally {
  $sourceImage.Dispose()
}
