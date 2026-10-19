@echo off
rem GLEECH terminal CLI and TUI, run with the app's embedded runtime.
rem Add this folder to PATH to type "gleech" anywhere.
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\..\GLEECH.exe" "%~dp0gleech.cjs" %*
