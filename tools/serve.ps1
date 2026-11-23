# Edytor na udawanych danych, bez Home Assistanta: http://localhost:8777/tests/editor.html
param([int]$Port = 8777)
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$maps = @{ 'panelpilot_static' = (Join-Path $repo 'custom_components\panelpilot\frontend'); 'tests' = (Join-Path $repo 'tests') }
$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8' }
$l = New-Object Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Start()
Write-Host "http://localhost:$Port/tests/editor.html"
while ($l.IsListening) {
  $c = $l.GetContext()
  try {
    $first, $rest = $c.Request.Url.AbsolutePath.TrimStart('/') -split '/', 2
    $root = $maps[$first]
    $f = if ($root -and $rest) { [IO.Path]::GetFullPath((Join-Path $root $rest)) }
    if ($f -and $f.StartsWith($root + '\') -and (Test-Path -LiteralPath $f -PathType Leaf)) {
      $b = [IO.File]::ReadAllBytes($f)
      $t = $types[[IO.Path]::GetExtension($f)]
      if ($t) { $c.Response.ContentType = $t }
      $c.Response.Headers['Cache-Control'] = 'no-store'
      $c.Response.OutputStream.Write($b, 0, $b.Length)
    } else { $c.Response.StatusCode = 404 }
  } catch { Write-Host $_ } finally { $c.Response.Close() }
}
