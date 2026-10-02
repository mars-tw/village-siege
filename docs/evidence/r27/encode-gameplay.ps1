param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
)

$ErrorActionPreference = 'Stop'
$raw = Join-Path $RepoRoot '.audit-tmp\r27\raw'
$out = Join-Path $RepoRoot 'apps\client\public\media\gameplay'
New-Item -ItemType Directory -Force $out | Out-Null

$clips = @(
  @{ Name = 'economy'; Start = 0.5; Duration = 24; Poster = 12 },
  @{ Name = 'movement'; Start = 18; Duration = 24; Poster = 32 },
  @{ Name = 'battle'; Start = 0; Duration = 24; Poster = 12 }
)

foreach ($clip in $clips) {
  $sourceName = if ($clip.Name -eq 'battle') { 'battle-direct.webm' } else { $clip.Name + '.webm' }
  $source = Join-Path $raw $sourceName
  $video = Join-Path $out ($clip.Name + '.mp4')
  $poster = Join-Path $out ($clip.Name + '.webp')

  if ($clip.Name -eq 'economy') {
    $construction = Join-Path $raw 'economy-construction.webm'
    & ffmpeg -y -v error -i $source -i $construction `
      -filter_complex '[0:v]trim=start=0.5:duration=5,setpts=PTS-STARTPTS,crop=800:450:0:0,scale=960:540:flags=lanczos,fps=24[v0];[1:v]trim=start=34:duration=19,setpts=PTS-STARTPTS,crop=800:450:0:0,scale=960:540:flags=lanczos,fps=24[v1];[v0][v1]concat=n=2:v=1:a=0[v]' `
      -map '[v]' -an -c:v libx264 -preset slow -b:v 520k -maxrate 650k -bufsize 1300k `
      -pix_fmt yuv420p -profile:v high -level 3.1 -movflags +faststart $video
  } else {
    & ffmpeg -y -v error -ss $clip.Start -i $source -t $clip.Duration `
      -an -vf 'crop=800:450:0:0,scale=960:540:flags=lanczos,fps=24' `
      -c:v libx264 -preset slow -b:v 520k -maxrate 650k -bufsize 1300k `
      -pix_fmt yuv420p -profile:v high -level 3.1 -movflags +faststart $video
  }
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg video encode failed: $($clip.Name)" }

  $posterSource = if ($clip.Name -eq 'economy') { Join-Path $raw 'economy-construction.webm' } else { $source }
  $posterTime = if ($clip.Name -eq 'economy') { 52 } else { $clip.Poster }
  & ffmpeg -y -v error -ss $posterTime -i $posterSource -frames:v 1 `
    -vf 'crop=800:450:0:0,scale=960:540:flags=lanczos' -c:v libwebp -quality 82 $poster
  if ($LASTEXITCODE -ne 0) { throw "ffmpeg poster encode failed: $($clip.Name)" }
}
