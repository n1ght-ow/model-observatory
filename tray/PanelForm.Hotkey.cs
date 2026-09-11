using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace RouterMonitorTray
{
    /// <summary>
    /// The global hotkey that summons the panel.
    ///
    /// Why this belongs to the tray rather than the page: a hotkey has to work while
    /// some other application is in front, and while the flyout is hidden - and when
    /// the flyout is hidden its WebView is suspended, so the page is not running at
    /// all. The tray is the only part of this that is always there.
    ///
    /// Registration is per window handle, so it happens in OnHandleCreated: the panel
    /// gets its handle at startup (TrayContext calls EnsureHandle), which means the
    /// key works before the panel has ever been opened.
    /// </summary>
    internal sealed partial class PanelForm
    {
        private const int WM_HOTKEY = 0x0312;
        private const uint MOD_ALT = 0x0001;
        private const uint MOD_CONTROL = 0x0002;
        private const uint MOD_SHIFT = 0x0004;
        private const uint MOD_WIN = 0x0008;
        private const uint MOD_NOREPEAT = 0x4000;

        /// <summary>An arbitrary id; only one hotkey is registered at a time.</summary>
        private const int HotkeyId = 0x524D; // "RM"

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint modifiers, uint key);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnregisterHotKey(IntPtr hwnd, int id);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        private string hotkeySpec = "";
        private bool hotkeyRegistered;
        private string hotkeyProblem;

        /// <summary>
        /// What the hotkey is doing, for `--ctl config` and `--ctl ping`. A key that
        /// silently failed to register looks exactly like one that works, so this is
        /// reported rather than assumed.
        /// </summary>
        public string HotkeyStatus
        {
            get
            {
                if (string.IsNullOrEmpty(hotkeySpec))
                {
                    return "disabled";
                }
                if (hotkeyRegistered)
                {
                    return hotkeySpec + " · registered";
                }
                return hotkeySpec + " · " + (hotkeyProblem ?? "not registered");
            }
        }

        /// <summary>The combination as configured, e.g. "Alt+A", or "" when disabled.</summary>
        public string HotkeySpec
        {
            get { return hotkeySpec; }
        }

        /// <summary>
        /// Applies a combination. Returns false when it could not be registered, which
        /// is nearly always because another program already owns it - the panel stays
        /// usable either way, because a hotkey is a convenience, not a dependency.
        /// </summary>
        public bool ApplyHotkey(string spec)
        {
            hotkeySpec = spec == null ? "" : spec.Trim();
            hotkeyProblem = null;
            UnregisterCurrentHotkey();

            if (string.IsNullOrEmpty(hotkeySpec))
            {
                LogInit("hotkey: disabled");
                return true;
            }

            uint modifiers;
            uint key;
            if (!TryParseHotkey(hotkeySpec, out modifiers, out key))
            {
                hotkeyProblem = "invalid combination";
                LogInit("hotkey: cannot parse '" + hotkeySpec + "'");
                return false;
            }

            if (!IsHandleCreated)
            {
                // Nothing to register against yet; OnHandleCreated will retry.
                hotkeyProblem = "waiting for the window";
                return false;
            }

            // MOD_NOREPEAT keeps a held key from firing repeatedly. It needs Windows 7+,
            // so a failure is retried without it rather than given up on.
            if (RegisterHotKey(Handle, HotkeyId, modifiers | MOD_NOREPEAT, key))
            {
                hotkeyRegistered = true;
                LogInit("hotkey: registered " + hotkeySpec);
                return true;
            }
            if (RegisterHotKey(Handle, HotkeyId, modifiers, key))
            {
                hotkeyRegistered = true;
                LogInit("hotkey: registered " + hotkeySpec + " (without MOD_NOREPEAT)");
                return true;
            }

            hotkeyRegistered = false;
            hotkeyProblem = "already taken by another program";
            LogInit("hotkey: " + hotkeySpec + " could not be registered (error " +
                Marshal.GetLastWin32Error() + ")");
            return false;
        }

        private void UnregisterCurrentHotkey()
        {
            if (!hotkeyRegistered || !IsHandleCreated)
            {
                hotkeyRegistered = false;
                return;
            }
            try
            {
                UnregisterHotKey(Handle, HotkeyId);
            }
            catch (Exception ex)
            {
                LogInit("hotkey: unregister failed (" + ex.Message + ")");
            }
            hotkeyRegistered = false;
        }

        /// <summary>
        /// Handles WM_HOTKEY. The panel is summoned unless it is already the foreground
        /// window, in which case the key hides it again - so one key both shows and
        /// dismisses, which is what a summon key is expected to do.
        /// </summary>
        private bool HandleHotkeyMessage(ref Message m)
        {
            if (m.Msg != WM_HOTKEY || m.WParam.ToInt32() != HotkeyId)
            {
                return false;
            }
            try
            {
                if (GetForegroundWindow() == Handle)
                {
                    HidePanel();
                }
                else
                {
                    ShowPanel();
                }
            }
            catch (Exception ex)
            {
                LogInit("hotkey: " + ex.Message);
            }
            return true;
        }

        /// <summary>
        /// "Alt+A" -> modifier flags and a virtual key.
        ///
        /// Deliberately a small, explicit grammar rather than anything clever: letters,
        /// digits and the function keys, with Ctrl / Alt / Shift / Win. One modifier is
        /// required, because a bare letter would swallow typing everywhere.
        /// </summary>
        internal static bool TryParseHotkey(string spec, out uint modifiers, out uint key)
        {
            modifiers = 0;
            key = 0;
            if (string.IsNullOrEmpty(spec))
            {
                return false;
            }

            string[] parts = spec.Split(new char[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2)
            {
                return false;
            }

            for (int i = 0; i < parts.Length; i++)
            {
                string part = parts[i].Trim();
                if (part.Length == 0)
                {
                    return false;
                }

                // The last token is the key; everything before it is a modifier.
                if (i < parts.Length - 1)
                {
                    if (string.Equals(part, "Ctrl", StringComparison.OrdinalIgnoreCase) ||
                        string.Equals(part, "Control", StringComparison.OrdinalIgnoreCase))
                    {
                        modifiers |= MOD_CONTROL;
                    }
                    else if (string.Equals(part, "Alt", StringComparison.OrdinalIgnoreCase))
                    {
                        modifiers |= MOD_ALT;
                    }
                    else if (string.Equals(part, "Shift", StringComparison.OrdinalIgnoreCase))
                    {
                        modifiers |= MOD_SHIFT;
                    }
                    else if (string.Equals(part, "Win", StringComparison.OrdinalIgnoreCase))
                    {
                        modifiers |= MOD_WIN;
                    }
                    else
                    {
                        return false;
                    }
                    continue;
                }

                uint parsed;
                if (!TryParseKey(part, out parsed))
                {
                    return false;
                }
                key = parsed;
            }

            return modifiers != 0 && key != 0;
        }

        private static bool TryParseKey(string token, out uint key)
        {
            key = 0;
            if (token.Length == 1)
            {
                char c = char.ToUpperInvariant(token[0]);
                if (c >= 'A' && c <= 'Z')
                {
                    key = (uint)c; // VK_A..VK_Z are the ASCII letters
                    return true;
                }
                if (c >= '0' && c <= '9')
                {
                    key = (uint)c; // VK_0..VK_9 are the ASCII digits
                    return true;
                }
                return false;
            }

            if ((token[0] == 'F' || token[0] == 'f') && token.Length <= 3)
            {
                int number;
                if (int.TryParse(token.Substring(1), out number) && number >= 1 && number <= 24)
                {
                    key = (uint)(0x70 + number - 1); // VK_F1 = 0x70
                    return true;
                }
            }
            return false;
        }
    }
}
