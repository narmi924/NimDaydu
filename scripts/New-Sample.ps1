$ErrorActionPreference = 'Stop'
$projectDir = Split-Path $PSScriptRoot -Parent
$sampleDir = Join-Path $projectDir 'samples'
New-Item -ItemType Directory -Force -Path $sampleDir | Out-Null
Add-Type -AssemblyName System.Speech
$speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voice = $speech.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'en-*' } | Select-Object -First 1
if (-not $voice) { throw 'No installed English Windows voice; use your own WAV sample instead.' }
$speech.SelectVoice($voice.VoiceInfo.Name)
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$speech.SetOutputToWaveFile((Join-Path $sampleDir 'english.wav'), $format)
$speech.Speak('Welcome to NimDaydu. We are testing live captions for a Discord meeting. Please open the staff dashboard and check the application form. The deadline is Friday, October ninth. Next, we will review the Java controller and push our changes to GitHub. Thank you for joining today.')
$speech.Dispose()
Write-Output 'Created samples/english.wav using an installed Windows voice.'
