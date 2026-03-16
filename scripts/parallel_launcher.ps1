
$CHUNKS = @(
    @{ start = 1; end = 10 },
    @{ start = 11; end = 20 },
    @{ start = 21; end = 30 },
    @{ start = 31; end = 40 }
)

Write-Host "=========================================="
Write-Host "Thermo Fisher Parallel Scraper Starting"
Write-Host "Launching $($CHUNKS.Count) parallel chunks..."
Write-Host "=========================================="

foreach ($chunk in $CHUNKS) {
    $s = $chunk.start
    $e = $chunk.end
    $log = "scrape_chunk_$($s)_$($e).log"
    Write-Host "Starting Chunk $s-$e (Logging to $log)..."
    Start-Process node -ArgumentList "scripts/scrape_thermo_gibco.js --startPage $s --endPage $e" -NoNewWindow -RedirectStandardOutput $log -RedirectStandardError $log
}

Write-Host "`nParallel processes launched. Monitor the .log files for progress."
Write-Host "Use 'Stop-Process -Name node' to stop all."
