; NSIS hooks for the Tauri installer (spec 06 "Færdigpakkede forbindelser"):
; put the folder with ppm-mcp.exe on the user's PATH (HKCU, the app installs per user)
; and remove it again on uninstall. No plugins: plain registry and string operations.

; $R0 = haystack, $R1 = needle  ->  $R2 = "1" if found, else "0" (case-insensitive).
!macro PPM_STR_CONTAINS_FN PREFIX
Function ${PREFIX}PPM_StrContains
  Push $R3
  Push $R4
  Push $R5
  StrLen $R3 $R1
  StrCpy $R4 0
  StrCpy $R2 0
  loop:
    StrCpy $R5 $R0 $R3 $R4
    StrCmp $R5 "" done
    StrCmp $R5 $R1 found
    IntOp $R4 $R4 + 1
    Goto loop
  found:
    StrCpy $R2 1
  done:
  Pop $R5
  Pop $R4
  Pop $R3
FunctionEnd
!macroend
!insertmacro PPM_STR_CONTAINS_FN ""

; $R0 = PATH value, $R1 = entry to remove  ->  $R2 = PATH without that entry.
Function un.PPM_RemoveFromPath
  Push $R3
  Push $R4
  Push $R5
  Push $R6
  StrCpy $R2 ""
  StrCpy $R3 ""
  StrCpy $R4 0
  StrLen $R6 $R0
  loop:
    IntCmp $R4 $R6 flush 0 flush
    StrCpy $R5 $R0 1 $R4
    StrCmp $R5 ";" flush
    StrCpy $R3 "$R3$R5"
    IntOp $R4 $R4 + 1
    Goto loop
  flush:
    StrCmp $R3 "" next
    StrCmp $R3 $R1 next
    StrCmp $R2 "" 0 +3
      StrCpy $R2 $R3
      Goto next
    StrCpy $R2 "$R2;$R3"
  next:
    StrCpy $R3 ""
    IntCmp $R4 $R6 done 0 done
    IntOp $R4 $R4 + 1
    Goto loop
  done:
  Pop $R6
  Pop $R5
  Pop $R4
  Pop $R3
FunctionEnd

!macro NSIS_HOOK_POSTINSTALL
  Push $R0
  Push $R1
  Push $R2
  ReadRegStr $R0 HKCU "Environment" "Path"
  StrCpy $R1 "$INSTDIR\resources\mcp"
  Push $R0
  StrCpy $R0 ";$R0;"
  Push $R1
  StrCpy $R1 ";$R1;"
  Call PPM_StrContains
  Pop $R1
  Pop $R0
  StrCmp $R2 1 ppm_path_done
  StrCmp $R0 "" 0 +3
    WriteRegExpandStr HKCU "Environment" "Path" "$R1"
    Goto ppm_path_notify
  WriteRegExpandStr HKCU "Environment" "Path" "$R0;$R1"
  ppm_path_notify:
  ; WM_SETTINGCHANGE to all windows so new terminals and AI clients see the new PATH.
  SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
  ppm_path_done:
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Push $R0
  Push $R1
  Push $R2
  ReadRegStr $R0 HKCU "Environment" "Path"
  StrCpy $R1 "$INSTDIR\resources\mcp"
  Call un.PPM_RemoveFromPath
  StrCmp $R2 $R0 +3
    WriteRegExpandStr HKCU "Environment" "Path" "$R2"
    SendMessage 0xFFFF 0x1A 0 "STR:Environment" /TIMEOUT=5000
  Pop $R2
  Pop $R1
  Pop $R0
!macroend
