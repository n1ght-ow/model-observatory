using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace RouterMonitorTray
{
    /// <summary>
    /// One request on the control channel.
    ///
    /// The envelope is deliberately tiny and versioned: a new tray capability is a
    /// new `cmd` value plus one row in the handler table, never a new command line
    /// switch and never a new top-level constant.
    /// </summary>
    internal sealed class ControlRequest
    {
        public int v = ControlProtocol.Version;
        public string id = "";
        public string cmd = "";
        public Dictionary<string, object> args = new Dictionary<string, object>();
    }

    /// <summary>The answer to one request. `lines` carries human/report text.</summary>
    internal sealed class ControlResponse
    {
        public int v = ControlProtocol.Version;
        public string id = "";
        public bool ok;
        public string error;
        public Dictionary<string, object> result;

        public static ControlResponse Success(string id, Dictionary<string, object> result)
        {
            ControlResponse response = new ControlResponse();
            response.id = id;
            response.ok = true;
            response.result = result == null ? new Dictionary<string, object>() : result;
            return response;
        }

        public static ControlResponse Failure(string id, string error)
        {
            ControlResponse response = new ControlResponse();
            response.id = id;
            response.ok = false;
            response.error = error;
            response.result = new Dictionary<string, object>();
            return response;
        }

        /// <summary>
        /// The report lines this response carries, in the same "label : value" shape
        /// the diagnostics reports have always used, so a forwarded run and a local
        /// run are indistinguishable to whatever reads the report.
        /// </summary>
        public List<string> Lines()
        {
            List<string> lines = new List<string>();
            if (!ok)
            {
                lines.Add("error           : " + (string.IsNullOrEmpty(error) ? "unknown failure" : error));
                return lines;
            }
            object raw;
            if (result != null && result.TryGetValue("lines", out raw))
            {
                // JavaScriptSerializer hands nested arrays back as ArrayList, not as
                // object[], so the sequence is walked rather than cast.
                IEnumerable items = raw as IEnumerable;
                if (items != null)
                {
                    foreach (object item in items)
                    {
                        lines.Add(Convert.ToString(item));
                    }
                }
            }
            return lines;
        }

        /// <summary>The machine readable half of the result, for assertions.</summary>
        public Dictionary<string, object> Fields()
        {
            if (result == null)
            {
                return new Dictionary<string, object>();
            }
            Dictionary<string, object> fields = new Dictionary<string, object>();
            object raw;
            if (result.TryGetValue("fields", out raw))
            {
                IDictionary map = raw as IDictionary;
                if (map != null)
                {
                    foreach (DictionaryEntry entry in map)
                    {
                        fields[Convert.ToString(entry.Key)] = entry.Value;
                    }
                }
            }
            return fields;
        }
    }

    internal delegate ControlResponse ControlHandler(ControlRequest request);

    /// <summary>Wire format: one JSON envelope per line, UTF-8, no BOM.</summary>
    internal static class ControlProtocol
    {
        public const int Version = 1;
        public const int ConnectTimeoutMs = 5000;
        public const int MaxMessageBytes = 4 * 1024 * 1024;

        internal static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        /// <summary>
        /// Per-user so two accounts on one machine cannot drive each other's tray.
        /// (PipeOptions.CurrentUserOnly does not exist on .NET Framework 4.0, which
        /// is the compiler this project still builds with.)
        /// </summary>
        public static string PipeName
        {
            get { return "RouterMonitorTray.control." + Environment.UserName; }
        }

        public static string Encode(object value)
        {
            lock (Serializer)
            {
                return Serializer.Serialize(value);
            }
        }

        public static ControlRequest DecodeRequest(string line)
        {
            ControlRequest request;
            lock (Serializer)
            {
                request = Serializer.Deserialize<ControlRequest>(line);
            }
            if (request == null)
            {
                throw new InvalidDataException("empty control request");
            }
            if (request.cmd == null)
            {
                request.cmd = "";
            }
            if (request.args == null)
            {
                request.args = new Dictionary<string, object>();
            }
            return request;
        }

        public static ControlResponse DecodeResponse(string line)
        {
            ControlResponse response;
            lock (Serializer)
            {
                response = Serializer.Deserialize<ControlResponse>(line);
            }
            if (response == null)
            {
                throw new InvalidDataException("empty control response");
            }
            return response;
        }

        /// <summary>Reads one newline terminated UTF-8 message, or null at end of stream.</summary>
        public static string ReadLine(Stream stream)
        {
            MemoryStream buffer = new MemoryStream();
            byte[] chunk = new byte[1];
            while (true)
            {
                int read = stream.Read(chunk, 0, 1);
                if (read <= 0)
                {
                    return buffer.Length == 0 ? null : Decode(buffer);
                }
                if (chunk[0] == (byte)'\n')
                {
                    return Decode(buffer);
                }
                buffer.WriteByte(chunk[0]);
                if (buffer.Length > MaxMessageBytes)
                {
                    throw new InvalidDataException("control message exceeds " + MaxMessageBytes + " bytes");
                }
            }
        }

        private static string Decode(MemoryStream buffer)
        {
            byte[] bytes = buffer.ToArray();
            int length = bytes.Length;
            if (length > 0 && bytes[length - 1] == (byte)'\r')
            {
                length--;
            }
            return new UTF8Encoding(false).GetString(bytes, 0, length);
        }

        public static void WriteLine(Stream stream, string text)
        {
            byte[] bytes = new UTF8Encoding(false).GetBytes(text + "\n");
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
        }
    }

    /// <summary>
    /// The tray's half of the channel: a background thread that accepts one
    /// connection at a time and answers it from the handler table. Handlers run on
    /// that thread, so anything touching the UI has to marshal itself.
    /// </summary>
    internal sealed class ControlServer
    {
        private readonly Dictionary<string, ControlHandler> handlers =
            new Dictionary<string, ControlHandler>(StringComparer.OrdinalIgnoreCase);
        private readonly string pipeName;
        private bool started;

        public ControlServer(string pipeName)
        {
            this.pipeName = pipeName;
        }

        /// <summary>Adding a capability is this one call and nothing else.</summary>
        public void Register(string cmd, ControlHandler handler)
        {
            handlers[cmd] = handler;
        }

        public string[] Commands()
        {
            List<string> names = new List<string>(handlers.Keys);
            names.Sort(StringComparer.OrdinalIgnoreCase);
            return names.ToArray();
        }

        public void Start()
        {
            if (started)
            {
                return;
            }
            started = true;
            Thread thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Name = "RouterMonitorTray.control";
            thread.Start();
        }

        private void Loop()
        {
            while (true)
            {
                try
                {
                    using (NamedPipeServerStream server = new NamedPipeServerStream(
                        pipeName, PipeDirection.InOut, 4, PipeTransmissionMode.Byte, PipeOptions.None))
                    {
                        server.WaitForConnection();
                        Answer(server);
                    }
                }
                catch (Exception ex)
                {
                    PanelForm.LogInit("control channel: " + ex.Message);
                    Thread.Sleep(250);
                }
            }
        }

        private void Answer(Stream stream)
        {
            string line = ControlProtocol.ReadLine(stream);
            if (line == null)
            {
                return;
            }

            ControlResponse response;
            string id = "";
            try
            {
                ControlRequest request = ControlProtocol.DecodeRequest(line);
                id = request.id;
                if (request.v != ControlProtocol.Version)
                {
                    response = ControlResponse.Failure(id,
                        "unsupported protocol version " + request.v + " (this tray speaks v" + ControlProtocol.Version + ")");
                }
                else
                {
                    ControlHandler handler;
                    if (handlers.TryGetValue(request.cmd, out handler))
                    {
                        response = handler(request);
                    }
                    else
                    {
                        response = ControlResponse.Failure(id,
                            "unknown command '" + request.cmd + "'; known: " + string.Join(", ", Commands()));
                    }
                }
            }
            catch (Exception ex)
            {
                response = ControlResponse.Failure(id, ex.Message);
            }

            if (response == null)
            {
                // A handler that answers by tearing the tray down replies first and
                // stops the process afterwards; there is nobody left to write to.
                return;
            }
            response.v = ControlProtocol.Version;
            ControlProtocol.WriteLine(stream, ControlProtocol.Encode(response));
        }
    }

    /// <summary>The client half, used by a second instance and by scripts.</summary>
    internal static class ControlClient
    {
        public static ControlResponse Send(string cmd, Dictionary<string, object> args, int timeoutMs)
        {
            ControlRequest request = new ControlRequest();
            request.id = Guid.NewGuid().ToString("N").Substring(0, 8);
            request.cmd = cmd;
            if (args != null)
            {
                request.args = args;
            }

            using (NamedPipeClientStream client = new NamedPipeClientStream(
                ".", ControlProtocol.PipeName, PipeDirection.InOut))
            {
                client.Connect(timeoutMs);
                ControlProtocol.WriteLine(client, ControlProtocol.Encode(request));
                string line = ControlProtocol.ReadLine(client);
                if (line == null)
                {
                    throw new IOException("the running tray closed the connection without answering");
                }
                return ControlProtocol.DecodeResponse(line);
            }
        }

        public static bool TrySend(string cmd, Dictionary<string, object> args, int timeoutMs, out ControlResponse response, out string error)
        {
            try
            {
                response = Send(cmd, args, timeoutMs);
                error = null;
                return true;
            }
            catch (Exception ex)
            {
                response = null;
                error = ex.Message;
                return false;
            }
        }
    }
}
