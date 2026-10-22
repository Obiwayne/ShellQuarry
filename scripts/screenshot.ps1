# Saves a PNG of the ShellQuarry window (for docs and launch images).
#   powershell -ExecutionPolicy Bypass -File scripts/screenshot.ps1 -Out shot.png
param([Parameter(Mandatory = $true)][string]$Out, [string]$Process = "shellquarry")
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class SqWin { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
public struct RECT { public int L, T, R, B; } }
'@
[SqWin]::SetProcessDPIAware() | Out-Null
$p = Get-Process $Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ([SqWin]::IsIconic($p.MainWindowHandle)) { [SqWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }
[SqWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 700
$r = New-Object SqWin+RECT
[SqWin]::DwmGetWindowAttribute($p.MainWindowHandle, 9, [ref]$r, 16) | Out-Null
$bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($Out)
"$($r.R - $r.L)x$($r.B - $r.T)"
