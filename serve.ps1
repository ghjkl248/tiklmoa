# Local preview server (PowerShell only, no Node/Python needed)
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8037]
param([int]$Port = 8037, [switch]$NoBrowser)
$root = $PSScriptRoot
$listener = $null
for ($p = $Port; $p -lt $Port + 10; $p++) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $Port = $p; break }
  catch { Write-Host "Port $p is in use (already running?), trying $($p + 1)..."; $l.Close() }
}
if (-not $listener) { Write-Host "No free port found. Close other servers and try again."; exit 1 }
Write-Host "Tiklmoa preview: http://localhost:$Port/  (Ctrl+C to stop)"
if (-not $NoBrowser) { try { Start-Process "http://localhost:$Port/" } catch {} }
$types = @{ '.html'='text/html; charset=utf-8'; '.css'='text/css; charset=utf-8'; '.js'='application/javascript; charset=utf-8';
            '.json'='application/json; charset=utf-8'; '.png'='image/png'; '.svg'='image/svg+xml'; '.ico'='image/x-icon'; '.webmanifest'='application/manifest+json' }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
  if ($path -eq '') { $path = 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $path))
  $res = $ctx.Response
  if ($file.StartsWith($root) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $ext = [IO.Path]::GetExtension($file).ToLower()
    if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
    $res.Headers.Add('Cache-Control', 'no-store')
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $res.StatusCode = 404 }
  $res.Close()
}
