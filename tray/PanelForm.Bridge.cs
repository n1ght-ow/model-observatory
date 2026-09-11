using System;
using System.Collections.Generic;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

namespace RouterMonitorTray
{
    /// <summary>
    /// The page/tray protocol: the injected bridge, its messages, and the navigation guards.
    ///
    /// PanelForm is split across partial files by responsibility, so a new tray
    /// capability is a region in the right file rather than a search through one
    /// 1,400 line class:
    ///
    ///   PanelForm.cs          window chrome, dragging, placement, layout
    ///   PanelForm.Scaling.cs  display scale, drawn size, ZoomFactor
    ///   PanelForm.WebView.cs  the WebView lifecycle
    ///   PanelForm.Bridge.cs   the page/tray protocol and navigation guards
    /// </summary>
    internal sealed partial class PanelForm : Form
    {
        /// <summary>
        /// The one place the page and the tray speak to each other. Every message is
        /// a versioned envelope - `{v:1,type:...}` - so the page can tell what it is
        /// running inside, and so a new message type is a new `case` on both sides
        /// rather than a new magic string. This is v1.
        /// </summary>
        private const string BridgeScript =
            "(function(){if(window.__rmBridge){return;}" +
            "var post=function(m){try{window.chrome.webview.postMessage(JSON.stringify(m));}catch(e){}};" +
            "var listen=function(fn){try{window.chrome.webview.addEventListener('message',function(e){" +
            "var m=e.data;if(typeof m==='string'){try{m=JSON.parse(m);}catch(err){return;}}" +
            "if(m&&m.v===1){fn(m);}});}catch(e){}};" +
            "window.__rmBridge={version:1,post:post,listen:listen," +
            "close:function(){post({v:1,type:'close'});}," +
            "openExternal:function(url){post({v:1,type:'openExternal',url:String(url)});}," +
            "setPinned:function(on){post({v:1,type:'pin',pinned:!!on});}," +
            "setStatus:function(text){post({v:1,type:'status',text:String(text)});}," +
            "ready:function(){post({v:1,type:'ready'});}};" +
            "document.addEventListener('keydown',function(e){" +
            "if(e.key!=='Escape'){return;}" +
            "var open=document.querySelector('[role=\"dialog\"],[role=\"listbox\"],[role=\"menu\"]');" +
            "if(open){return;}" +
            "window.__rmBridge.close();" +
            "},true);" +
            "post({v:1,type:'bridge'});})();";

        private string bridgeLastMessage = "(none)";

        private string lastDashboardUri;

        private bool cancelledNavigation;

        public string BridgeState
        {
            get { return bridgeLastMessage; }
        }

        /// <summary>
        /// Raised when the page pins or unpins the panel, so the tray menu and the
        /// settings file can follow a decision that was made inside the page.
        /// </summary>
        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string raw;
            try
            {
                raw = e.TryGetWebMessageAsString();
            }
            catch (Exception ex)
            {
                LogInit("bridge: unreadable message (" + ex.Message + ")");
                return;
            }
            if (string.IsNullOrEmpty(raw))
            {
                return;
            }

            string type = raw;
            string url = null;
            string statusText = null;
            bool pinned = false;
            bool wellFormed = false;

            if (raw[0] == '{')
            {
                try
                {
                    Dictionary<string, object> envelope =
                        ControlProtocol.Serializer.Deserialize<Dictionary<string, object>>(raw);
                    type = Field(envelope, "type");
                    url = Field(envelope, "url");
                    statusText = Field(envelope, "text");
                    pinned = Flag(envelope, "pinned");
                    wellFormed = Field(envelope, "v") == "1";
                }
                catch (Exception ex)
                {
                    LogInit("bridge: bad envelope (" + ex.Message + "): " + Truncate(raw));
                    return;
                }
            }
            else if (raw != "rm:close")
            {
                wellFormed = false;
            }
            else
            {
                // The pre-v1 magic string, kept working so an older cached page cannot
                // wedge the flyout.
                type = "close";
            }

            if (!wellFormed && raw[0] == '{')
            {
                LogInit("bridge: unsupported version in " + Truncate(raw));
                return;
            }

            bridgeLastMessage = type;
            switch (type)
            {
                case "bridge":
                case "ready":
                    // The page is up and knows where it is; tell it what the tray thinks.
                    PublishState();
                    break;
                case "close":
                    HidePanel();
                    break;
                case "openExternal":
                    Program.OpenExternal(url);
                    break;
                case "pin":
                    StayOpen = pinned;
                    if (PinnedChanged != null)
                    {
                        PinnedChanged(pinned);
                    }
                    PublishState();
                    break;
                case "status":
                    if (StatusReported != null)
                    {
                        StatusReported(statusText == null ? "" : statusText);
                    }
                    break;
                default:
                    LogInit("bridge: unknown type '" + type + "'");
                    break;
            }
        }

        /// <summary>Tells the page what the tray currently is, over the same protocol.</summary>

        private void PublishState()
        {
            if (!webViewReady)
            {
                return;
            }
            try
            {
                Dictionary<string, object> state = new Dictionary<string, object>();
                state["v"] = 1;
                state["type"] = "state";
                state["pinned"] = stayOpen;
                controller.CoreWebView2.PostWebMessageAsJson(ControlProtocol.Encode(state));
            }
            catch (Exception ex)
            {
                LogInit("bridge: could not publish state (" + ex.Message + ")");
            }
        }

        private static string Field(Dictionary<string, object> map, string key)
        {
            object raw;
            if (map != null && map.TryGetValue(key, out raw) && raw != null)
            {
                return Convert.ToString(raw);
            }
            return null;
        }

        /// <summary>
        /// Reads a JSON boolean. Convert.ToString on a bool gives "True", so comparing
        /// the text against "true" silently answers false for every value.
        /// </summary>
        private static bool Flag(Dictionary<string, object> map, string key)
        {
            object raw;
            if (map == null || !map.TryGetValue(key, out raw) || raw == null)
            {
                return false;
            }
            if (raw is bool)
            {
                return (bool)raw;
            }
            string text = Convert.ToString(raw).Trim();
            return string.Equals(text, "true", StringComparison.OrdinalIgnoreCase) || text == "1";
        }

        private static string Truncate(string text)
        {
            if (text == null)
            {
                return "(null)";
            }
            return text.Length <= 200 ? text : text.Substring(0, 200) + "...";
        }

        /// <summary>
        /// The flyout has no address bar and no back button, so a navigation away from
        /// the dashboard is a one way trip - clicking one of the "JSON" links used to
        /// strand the panel on a bare API response. Anything that is not our own origin
        /// is cancelled here and handed to the real browser instead.
        /// </summary>
        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (IsDashboard(e.Uri))
            {
                return;
            }
            e.Cancel = true;
            // Cancelling still produces a NavigationCompleted with a failure status,
            // and that would put the "page failed to load" label on screen for a
            // navigation the user never wanted in the first place.
            cancelledNavigation = true;
            if (IsWeb(e.Uri))
            {
                LogInit("navigation: blocked " + Truncate(e.Uri) + " (opening it externally)");
                Program.OpenExternal(e.Uri);
            }
            else
            {
                // about:blank and friends are the engine's own business, not the user's.
                LogInit("navigation: refused " + Truncate(e.Uri));
            }
        }

        private static bool IsWeb(string uri)
        {
            if (string.IsNullOrEmpty(uri))
            {
                return false;
            }
            return uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// A target="_blank" link with nobody listening gets a WebView2 popup window,
        /// which has no chrome and cannot be closed from the page. Handing it to the
        /// system browser is what the user meant by "open this".
        /// </summary>
        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
            if (IsWeb(e.Uri))
            {
                LogInit("navigation: new window " + Truncate(e.Uri) + " (opening it externally)");
                Program.OpenExternal(e.Uri);
            }
            else
            {
                LogInit("navigation: refused new window " + Truncate(e.Uri));
            }
        }

        /// <summary>
        /// Whether a URL is a page the flyout can be left sitting on. Same origin is
        /// not enough: the dashboard's own JSON endpoints live there too, and a bare
        /// API response has no chrome to navigate back with - that is exactly how the
        /// panel used to get stranded.
        /// </summary>
        private static bool IsDashboard(string uri)
        {
            if (string.IsNullOrEmpty(uri))
            {
                return false;
            }
            if (!uri.StartsWith(ServerHost.BaseUrl, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
            string path = uri.Substring(ServerHost.BaseUrl.Length);
            return !path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Hiding suspends the WebView instead of destroying it: the page keeps its
        /// state and reopening is a warm resume measured in milliseconds. Node and
        /// the WebView processes both stay alive, which is what keeps clicks snappy.
        /// </summary>
    }
}
