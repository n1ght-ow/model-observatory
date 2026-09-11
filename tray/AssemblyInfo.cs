using System.Reflection;
using System.Runtime.InteropServices;

// Version information for the tray executable.
//
// These are what Windows shows in the file's Properties dialog, which matters for a
// process that runs all day: without them the executable reports 0.0.0.0 and an empty
// description, so there is no way to tell which build is on the machine.
//
// AssemblyInformationalVersion is deliberately NOT here: build-tray.ps1 generates it
// with the commit and build date, so the dialog names the exact build.
[assembly: AssemblyTitle("Router Monitor Tray")]
[assembly: AssemblyDescription("System tray flyout for the Router Monitor dashboard")]
[assembly: AssemblyProduct("Router Monitor")]
[assembly: AssemblyCompany("Router Monitor")]
[assembly: AssemblyCopyright("")]
[assembly: AssemblyConfiguration("")]
[assembly: AssemblyCulture("")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]
[assembly: ComVisible(false)]
