using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Text;
using System.Reflection;

namespace RouterMonitorTray
{
    /// <summary>
    /// Registers the embedded Geist faces so drawn text uses the same font the
    /// web app does (next/font bundles Geist; see scripts\generate-tray-fonts.py).
    /// Falls back to the system UI font when the resources are missing.
    /// </summary>
    internal static class Fonts
    {
        private static readonly PrivateFontCollection Collection = new PrivateFontCollection();
        private static readonly List<IntPtr> Buffers = new List<IntPtr>();

        public static bool Loaded;

        public static void Load()
        {
            if (Loaded)
            {
                return;
            }
            Loaded = true;
            Assembly assembly = Assembly.GetExecutingAssembly();
            string[] resources = assembly.GetManifestResourceNames();
            for (int i = 0; i < resources.Length; i++)
            {
                if (!resources[i].EndsWith(".ttf", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                try
                {
                    using (System.IO.Stream stream = assembly.GetManifestResourceStream(resources[i]))
                    {
                        if (stream == null)
                        {
                            continue;
                        }
                        byte[] bytes = new byte[stream.Length];
                        int read = 0;
                        while (read < bytes.Length)
                        {
                            int step = stream.Read(bytes, read, bytes.Length - read);
                            if (step <= 0)
                            {
                                break;
                            }
                            read += step;
                        }
                        IntPtr buffer = System.Runtime.InteropServices.Marshal.AllocCoTaskMem(bytes.Length);
                        System.Runtime.InteropServices.Marshal.Copy(bytes, 0, buffer, bytes.Length);
                        Buffers.Add(buffer);
                        Collection.AddMemoryFont(buffer, bytes.Length);
                    }
                }
                catch
                {
                }
            }
        }

        /// <summary>Every face registered from the embedded resources.</summary>
        public static FontFamily[] Families()
        {
            Load();
            return Collection.Families;
        }

        /// <summary>The registered faces, in the order the generator emitted them.</summary>
        public static FontFamily Find(string family)
        {
            Load();
            for (int i = 0; i < Collection.Families.Length; i++)
            {
                if (string.Equals(Collection.Families[i].Name, family, StringComparison.OrdinalIgnoreCase))
                {
                    return Collection.Families[i];
                }
            }
            return null;
        }
    }
}