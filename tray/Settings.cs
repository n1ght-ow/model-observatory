using System;
using System.Collections.Generic;
using System.IO;
using System.Web.Script.Serialization;

namespace RouterMonitorTray
{
    /// <summary>
    /// Everything that used to be a compile-time constant and turned out to be a
    /// preference. Public fields, because JavaScriptSerializer fills fields.
    /// </summary>
    internal sealed class TraySettings
    {
        public int v = 1;

        /// <summary>False until the user has dragged the panel somewhere.</summary>
        public bool hasPosition;
        public int windowX;
        public int windowY;

        /// <summary>Whether the flyout survives losing focus (the "固定面板" menu item).</summary>
        public bool stayOpen;

        public bool topMost = true;

        /// <summary>Drawn size as a fraction of the browser's own; the CSS viewport never changes.</summary>
        public double userScale = 0.85;

        public int dragStripHeight = 20;

        public int port = 3000;

        /// <summary>
        /// Global hotkey that summons the panel, e.g. "Alt+A". Empty disables it. Kept as
        /// text rather than a key code so the file stays readable and hand-editable.
        /// </summary>
        public string hotkey = "Alt+A";
    }

    /// <summary>
    /// Settings live in %LOCALAPPDATA%\RouterMonitorTray\settings.json. A missing
    /// file is the defaults, and a damaged one is the defaults plus a note in the
    /// log - the tray must never fail to start because of this file.
    /// </summary>
    internal static class SettingsStore
    {
        private static readonly object Gate = new object();
        private static TraySettings current;

        public static string FilePath()
        {
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "RouterMonitorTray");
            return Path.Combine(dir, "settings.json");
        }

        /// <summary>The live settings object. Every caller shares one instance.</summary>
        public static TraySettings Current
        {
            get
            {
                lock (Gate)
                {
                    if (current == null)
                    {
                        current = LoadOrDefaults();
                    }
                    return current;
                }
            }
        }

        private static TraySettings LoadOrDefaults()
        {
            string path = FilePath();
            if (!File.Exists(path))
            {
                return new TraySettings();
            }
            try
            {
                string text = File.ReadAllText(path);
                TraySettings loaded;
                lock (Gate)
                {
                    loaded = ControlProtocol.Serializer.Deserialize<TraySettings>(text);
                }
                if (loaded == null)
                {
                    throw new InvalidDataException("settings file is empty");
                }
                Clamp(loaded);
                PanelForm.LogInit("settings: loaded " + path);
                return loaded;
            }
            catch (Exception ex)
            {
                // Keep the damaged file for inspection, start clean, say so once.
                PanelForm.LogInit("settings: " + path + " is unusable (" + ex.Message + "); using defaults");
                try
                {
                    File.Copy(path, path + ".bad", true);
                }
                catch
                {
                }
                return new TraySettings();
            }
        }

        /// <summary>Values outside these ranges are more likely a typo than an intent.</summary>
        private static void Clamp(TraySettings settings)
        {
            if (settings.userScale < 0.5 || settings.userScale > 2.0 || double.IsNaN(settings.userScale))
            {
                settings.userScale = 0.85;
            }
            if (settings.dragStripHeight < 0 || settings.dragStripHeight > 60)
            {
                settings.dragStripHeight = 20;
            }
            if (settings.port < 1024 || settings.port > 65535)
            {
                settings.port = 3000;
            }
            if (settings.v < 1)
            {
                settings.v = 1;
            }
            // Empty means "disabled" and is valid. Anything else has to parse, or a typo
            // would leave the tray without the key the user thinks they configured.
            if (settings.hotkey == null)
            {
                settings.hotkey = "Alt+A";
            }
            else if (settings.hotkey.Trim().Length > 0)
            {
                uint modifiers;
                uint key;
                if (!PanelForm.TryParseHotkey(settings.hotkey, out modifiers, out key))
                {
                    PanelForm.LogInit("settings: hotkey '" + settings.hotkey + "' is not a combination; using Alt+A");
                    settings.hotkey = "Alt+A";
                }
            }
        }

        /// <summary>Writes the current settings. Never throws: a lost preference is not a crash.</summary>
        public static void Save()
        {
            string path = FilePath();
            string temp = path + ".tmp";
            try
            {
                string dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                {
                    Directory.CreateDirectory(dir);
                }
                string text;
                lock (Gate)
                {
                    text = ControlProtocol.Serializer.Serialize(Current);
                }
                File.WriteAllText(temp, text);
                File.Copy(temp, path, true);
                File.Delete(temp);
            }
            catch (Exception ex)
            {
                PanelForm.LogInit("settings: could not save " + path + " (" + ex.Message + ")");
                try
                {
                    if (File.Exists(temp))
                    {
                        File.Delete(temp);
                    }
                }
                catch
                {
                }
            }
        }

        /// <summary>Forgets the remembered window position, so the panel docks to the tray again.</summary>
        public static void ForgetPosition()
        {
            TraySettings settings = Current;
            settings.hasPosition = false;
            settings.windowX = 0;
            settings.windowY = 0;
            Save();
        }

        /// <summary>Remembers where the panel was left.</summary>
        public static void RememberPosition(int x, int y)
        {
            TraySettings settings = Current;
            settings.hasPosition = true;
            settings.windowX = x;
            settings.windowY = y;
            Save();
        }
    }
}
