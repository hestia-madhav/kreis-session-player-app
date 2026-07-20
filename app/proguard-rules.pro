# NanoHTTPd
-keep class fi.iki.elonen.** { *; }

# JS interface
-keepclassmembers class org.cmca.player.PlayerBridge {
    @android.webkit.JavascriptInterface <methods>;
}
