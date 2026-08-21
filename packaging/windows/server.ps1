$ErrorActionPreference = "Stop"

$siteRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "site"))
$port = if ($env:FERAL_TRAINER_PORT) { [int]$env:FERAL_TRAINER_PORT } else { 8787 }

if ($port -lt 1024 -or $port -gt 65535) {
  throw "FERAL_TRAINER_PORT 必须是 1024–65535 的端口号。"
}
if (-not (Test-Path -LiteralPath (Join-Path $siteRoot "demo\index.html") -PathType Leaf)) {
  throw "离线网页文件不完整：site\demo\index.html 不存在。"
}

$mimeTypes = @{
  ".css" = "text/css; charset=utf-8"
  ".html" = "text/html; charset=utf-8"
  ".js" = "text/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".png" = "image/png"
  ".svg" = "image/svg+xml"
  ".wasm" = "application/wasm"
}

function Send-Response {
  param(
    [Parameter(Mandatory = $true)] $Stream,
    [Parameter(Mandatory = $true)] [int] $Status,
    [Parameter(Mandatory = $true)] [string] $Reason,
    [Parameter(Mandatory = $true)] [byte[]] $Body,
    [Parameter(Mandatory = $true)] [string] $ContentType,
    [bool] $HeadOnly = $false
  )
  $header = "HTTP/1.1 $Status $Reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
try {
  $listener.Start()
  $url = "http://127.0.0.1:$port/demo/"
  Write-Host "Ashamane Lab 已启动：$url"
  Write-Host "关闭此窗口即可停止本地服务。"
  if ($env:FERAL_TRAINER_NO_OPEN -ne "1") {
    Start-Process $url
  }

  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }
      do { $line = $reader.ReadLine() } while ($null -ne $line -and $line.Length -gt 0)

      $parts = $requestLine.Split(" ")
      if ($parts.Length -lt 2 -or ($parts[0] -ne "GET" -and $parts[0] -ne "HEAD")) {
        Send-Response -Stream $stream -Status 405 -Reason "Method Not Allowed" -Body ([Text.Encoding]::UTF8.GetBytes("Method Not Allowed")) -ContentType "text/plain; charset=utf-8"
        continue
      }

      $requestTarget = $parts[1]
      $queryIndex = $requestTarget.IndexOf("?")
      if ($queryIndex -ge 0) { $requestTarget = $requestTarget.Substring(0, $queryIndex) }
      $requestPath = [Uri]::UnescapeDataString($requestTarget).Replace("/", [IO.Path]::DirectorySeparatorChar)
      if ($requestPath -eq [IO.Path]::DirectorySeparatorChar) {
        $requestPath = [IO.Path]::DirectorySeparatorChar + "demo" + [IO.Path]::DirectorySeparatorChar
      }
      $relativePath = $requestPath.TrimStart([IO.Path]::DirectorySeparatorChar)
      $candidate = [IO.Path]::GetFullPath((Join-Path $siteRoot $relativePath))
      $rootPrefix = $siteRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
      if (-not $candidate.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Send-Response -Stream $stream -Status 403 -Reason "Forbidden" -Body ([Text.Encoding]::UTF8.GetBytes("Forbidden")) -ContentType "text/plain; charset=utf-8"
        continue
      }
      if (Test-Path -LiteralPath $candidate -PathType Container) {
        $candidate = Join-Path $candidate "index.html"
      }
      if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        Send-Response -Stream $stream -Status 404 -Reason "Not Found" -Body ([Text.Encoding]::UTF8.GetBytes("Not Found")) -ContentType "text/plain; charset=utf-8"
        continue
      }

      $body = [IO.File]::ReadAllBytes($candidate)
      $extension = [IO.Path]::GetExtension($candidate).ToLowerInvariant()
      $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { "application/octet-stream" }
      Send-Response -Stream $stream -Status 200 -Reason "OK" -Body $body -ContentType $contentType -HeadOnly ($parts[0] -eq "HEAD")
    }
    catch {
      Write-Warning $_.Exception.Message
    }
    finally {
      if ($reader) { $reader.Dispose() }
      if ($stream) { $stream.Dispose() }
      $client.Dispose()
    }
  }
}
finally {
  $listener.Stop()
}
