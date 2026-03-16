
$PRODUCT_TARGET = 593
$MAX_RETRIES = 50
$retryCount = 0

$LOG_FILE = "scrape_output.log"
Write-Host "=========================================="
Write-Host "Thermo Fisher Scraper Supervisor Starting"
Write-Host "Logs redirected to $LOG_FILE"
Write-Host "=========================================="

while ($retryCount -lt $MAX_RETRIES) {
    Write-Host "Starting Scraper (Attempt $($retryCount + 1))..."
    node scripts/scrape_thermo_gibco.js | Out-File -FilePath $LOG_FILE -Append -Encoding utf8
    
    $exitCode = $LASTEXITCODE
    if ($exitCode -eq 0) {
        Write-Host "Scraping completed successfully!"
        break
    } else {
        Write-Host "Scraper exited with code $exitCode. Restarting in 10 seconds..."
        $retryCount++
        Start-Sleep -Seconds 10
    }
}

if ($retryCount -ge $MAX_RETRIES) {
    Write-Host "Reached maximum retry limit."
}
