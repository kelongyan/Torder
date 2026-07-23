!macro customInstall
  CopyFiles "$INSTDIR\resources\WebView2Loader.dll" "$INSTDIR\WebView2Loader.dll"
  CopyFiles "$INSTDIR\target\release\WebView2Loader.dll" "$INSTDIR\WebView2Loader.dll"
  CopyFiles "$INSTDIR\resources\target\release\WebView2Loader.dll" "$INSTDIR\WebView2Loader.dll"
!macroend

