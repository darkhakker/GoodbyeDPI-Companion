using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.RegularExpressions;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Threading;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;

namespace GoodbyeDPICompanion {
    public class Settings {
        public bool enabled = false;
        public string profile = "balanced";
        public string[] domains = new string[0];
    }
    public static class Protocol {
        public const int Limit = 262144;
        public static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = Limit, RecursionLimit = 16 };
        public static byte[] ReadExact(Stream stream, int count, int timeout) {
            var result = new byte[count]; int position = 0;
            while (position < count) {
                int read;
                if (timeout > 0) {
                    var pending = stream.BeginRead(result, position, count - position, null, null);
                    if (!pending.AsyncWaitHandle.WaitOne(timeout)) { stream.Dispose(); throw new IOException("Message timeout"); }
                    read = stream.EndRead(pending); pending.AsyncWaitHandle.Close();
                } else read = stream.Read(result, position, count - position);
                if (read == 0) throw new EndOfStreamException();
                position += read;
            }
            return result;
        }
        public static string Read(Stream stream, int timeout) {
            int size = BitConverter.ToInt32(ReadExact(stream, 4, timeout), 0);
            if (size <= 0 || size > Limit) throw new InvalidDataException("Message size rejected");
            return new UTF8Encoding(false, true).GetString(ReadExact(stream, size, timeout));
        }
        public static void Write(Stream stream, object value) {
            byte[] body = Encoding.UTF8.GetBytes(Json.Serialize(value));
            if (body.Length > Limit) throw new InvalidDataException("Reply too large");
            byte[] length = BitConverter.GetBytes(body.Length);
            stream.Write(length, 0, length.Length); stream.Write(body, 0, body.Length); stream.Flush();
        }
    }
    public static class Policy {
        public static readonly Dictionary<string, string> Profiles = new Dictionary<string, string> {
            {"balanced", "-r -f 2 -e 2 --native-frag --reverse-frag --wrong-seq --wrong-chksum --max-payload 1200"},
            {"sequence", "-r -f 2 -e 2 --native-frag --reverse-frag --wrong-seq --max-payload 1200"},
            {"fragment", "-r -f 2 -e 2 --native-frag --reverse-frag --max-payload 1200"}
        };
        private static readonly Regex Domain = new Regex(@"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$", RegexOptions.CultureInvariant);
        private static HashSet<string> rules, wildcard, exceptions;
        public static void LoadSuffixes(string path) {
            rules = new HashSet<string>(); wildcard = new HashSet<string>(); exceptions = new HashSet<string>();
            var idn = new System.Globalization.IdnMapping();
            foreach (var raw in File.ReadAllLines(path)) {
                var line = raw.Trim(); if (line.Length == 0 || line.StartsWith("//")) continue;
                var set = line.StartsWith("!") ? exceptions : line.StartsWith("*.") ? wildcard : rules;
                line = line.TrimStart('!'); if (line.StartsWith("*.")) line = line.Substring(2);
                set.Add(idn.GetAscii(line).ToLowerInvariant());
            }
        }
        public static bool ValidDomain(string host) {
            if (host == null || !Domain.IsMatch(host)) return false;
            if (rules == null) throw new InvalidOperationException("Domain policy not loaded");
            var labels = host.Split('.'); int suffix = 1;
            for (int i = 0; i < labels.Length; i++) {
                string value = String.Join(".", labels.Skip(i));
                if (exceptions.Contains(value)) { suffix = labels.Length - i - 1; break; }
                if (rules.Contains(value)) suffix = Math.Max(suffix, labels.Length - i);
                if (i > 0 && wildcard.Contains(value)) suffix = Math.Max(suffix, labels.Length - i + 1);
            }
            return labels.Length > suffix;
        }
        public static Settings Validate(string text) {
            var data = Protocol.Json.Deserialize<Dictionary<string, object>>(text);
            if (data == null || !data.ContainsKey("command") || !(data["command"] is string) || (string)data["command"] != "configure") throw new InvalidDataException("Unsupported command");
            if (data.Keys.Any(x => x != "command" && x != "domains" && x != "enabled" && x != "profile")) throw new InvalidDataException("Unexpected field");
            if (!data.ContainsKey("enabled") || !(data["enabled"] is bool)) throw new InvalidDataException("enabled must be boolean");
            if (!data.ContainsKey("profile") || !(data["profile"] is string) || !Profiles.ContainsKey((string)data["profile"])) throw new InvalidDataException("Unknown profile");
            if (!data.ContainsKey("domains")) throw new InvalidDataException("Missing domains");
            var array = data["domains"] as System.Collections.ArrayList;
            if (array == null || array.Count > 2500) throw new InvalidDataException("Invalid domain list (maximum 2500)");
            var domains = new SortedSet<string>(StringComparer.Ordinal);
            foreach (object item in array) {
                if (!(item is string) || !ValidDomain((string)item)) throw new InvalidDataException("Invalid domain or public suffix");
                domains.Add((string)item);
            }
            return new Settings { enabled = (bool)data["enabled"], profile = (string)data["profile"], domains = domains.ToArray() };
        }
    }
    public static class Program {
        public const string ServiceName = "GoodbyeDPICompanion";
        public static readonly string Home = AppDomain.CurrentDomain.BaseDirectory;
        public static string PipeName(string sid) { return "GoodbyeDPICompanion-" + sid; }
        public static int Main(string[] args) {
            if (args.Length > 0 && args[0] == "--service") { ServiceBase.Run(new CompanionService()); return 0; }
            if (args.Length > 0 && args[0] == "--self-test") return SelfTest();
            Stream output = Console.OpenStandardOutput();
            try {
                if (args.Length == 0 || args[0] != "chrome-extension://" + BuildInfo.ExtensionId + "/") throw new UnauthorizedAccessException("Unexpected extension origin");
                string input = Protocol.Read(Console.OpenStandardInput(), 0);
                string sid = WindowsIdentity.GetCurrent().User.Value;
                using (var pipe = new NamedPipeClientStream(".", PipeName(sid), PipeDirection.InOut, PipeOptions.Asynchronous, TokenImpersonationLevel.Impersonation)) {
                    pipe.Connect(2500);
                    // Forward JSON without executing any strings from the browser.
                    byte[] bytes = Encoding.UTF8.GetBytes(input); var size = BitConverter.GetBytes(bytes.Length);
                    pipe.Write(size, 0, 4); pipe.Write(bytes, 0, bytes.Length); pipe.Flush();
                    string reply = Protocol.Read(pipe, 15000);
                    Protocol.Write(output, Protocol.Json.DeserializeObject(reply));
                }
                return 0;
            } catch (Exception e) { Protocol.Write(output, new { ok = false, error = e.Message }); return 1; }
        }
        private static int SelfTest() {
            try {
                Policy.LoadSuffixes(Path.Combine(Home, "public_suffix_list.dat"));
                if (!Policy.ValidDomain("tiktok.com") || Policy.ValidDomain("co.uk") || Policy.ValidDomain("com") || Policy.ValidDomain("bad.com --port 123") || Policy.ValidDomain("127.0.0.1")) throw new Exception("Domain policy failed");
                var config = Policy.Validate("{\"command\":\"configure\",\"domains\":[\"tiktok.com\"],\"profile\":\"balanced\",\"enabled\":false}");
                if (config.domains.Length != 1) throw new Exception("Config decode failed");
                foreach (string bad in new [] {
                    "{\"command\":\"exec\"}",
                    "{\"command\":\"configure\",\"domains\":[\"com\"],\"profile\":\"balanced\",\"enabled\":false}",
                    "{\"command\":\"configure\",\"domains\":[\"good.com --port 12\"],\"profile\":\"balanced\",\"enabled\":false}",
                    "{\"command\":\"configure\",\"domains\":[],\"profile\":\"-9\",\"enabled\":true}",
                    "{\"command\":\"configure\",\"domains\":[],\"profile\":\"balanced\",\"enabled\":true,\"path\":\"cmd.exe\"}"
                }) {
                    bool rejected = false;
                    try { Policy.Validate(bad); } catch (InvalidDataException) { rejected = true; }
                    if (!rejected) throw new Exception("Unsafe command accepted");
                }
                using (var oversized = new MemoryStream(BitConverter.GetBytes(Protocol.Limit + 1))) {
                    bool rejected = false;
                    try { Protocol.Read(oversized, 0); } catch (InvalidDataException) { rejected = true; }
                    if (!rejected) throw new Exception("Oversized frame accepted");
                }
                using (var memory = new MemoryStream()) { Protocol.Write(memory, new { ok = true }); memory.Position = 0; if (!Protocol.Read(memory, 0).Contains("true")) throw new Exception("Framing failed"); }
                foreach (string profile in Policy.Profiles.Values) if (profile.Contains("-q") || profile.Contains("dns-") || profile.Contains("allow-no-sni") || !profile.Contains("--native-frag")) throw new Exception("Global traffic option rejected");
                Console.WriteLine("Native protocol and policy checks passed"); return 0;
            } catch (Exception e) { Console.Error.WriteLine(e); return 1; }
        }
    }
    public class CompanionService : ServiceBase {
        private volatile bool stopping;
        private NamedPipeServerStream server;
        private Thread worker;
        private readonly object gate = new object();
        private readonly object logGate = new object();
        private Settings settings = new Settings();
        private Process engine;
        private IntPtr job = IntPtr.Zero;
        private string ownerSid, dataPath;
        private string lastError = "";
        public CompanionService() { ServiceName = Program.ServiceName; CanStop = true; AutoLog = true; }
        protected override void OnStart(string[] args) {
            dataPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "GoodbyeDPICompanion");
            ownerSid = File.ReadAllText(Path.Combine(Program.Home, "owner.sid")).Trim();
            new SecurityIdentifier(ownerSid);
            Policy.LoadSuffixes(Path.Combine(Program.Home, "public_suffix_list.dat"));
            string configPath = Path.Combine(dataPath, "settings.json");
            if (File.Exists(configPath)) {
                var saved = Protocol.Json.Deserialize<Settings>(File.ReadAllText(configPath));
                settings = Policy.Validate(Protocol.Json.Serialize(new { command = "configure", domains = saved.domains, enabled = saved.enabled, profile = saved.profile }));
            }
            worker = new Thread(Serve) { IsBackground = true }; worker.Start();
            lock (gate) { if (settings.enabled && settings.domains.Length > 0) TryStart(); }
        }
        protected override void OnStop() {
            stopping = true;
            try { if (server != null) server.Dispose(); } catch { }
            if (worker != null) worker.Join(5000);
            lock (gate) { StopEngine(); }
        }
        private void Serve() {
            while (!stopping) {
                try {
                    var security = new PipeSecurity(); security.SetAccessRuleProtection(true, false);
                    security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(ownerSid), PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize, AccessControlType.Allow));
                    security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
                    using (var pipe = new NamedPipeServerStream(Program.PipeName(ownerSid), PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security)) {
                        server = pipe; if (stopping) break;
                        pipe.WaitForConnection();
                        string text = Protocol.Read(pipe, 3000);
                        string caller = null;
                        pipe.RunAsClient(() => { caller = WindowsIdentity.GetCurrent().User.Value; });
                        if (caller != ownerSid) throw new UnauthorizedAccessException("Only the installation owner may control this service");
                        object result;
                        try {
                            Settings next = Policy.Validate(text);
                            lock (gate) {
                                bool changed = Protocol.Json.Serialize(next) != Protocol.Json.Serialize(settings);
                                if (changed) {
                                    StopEngine(); settings = next;
                                    File.WriteAllText(Path.Combine(dataPath, "settings.json"), Protocol.Json.Serialize(settings), new UTF8Encoding(false));
                                    File.WriteAllLines(Path.Combine(dataPath, "domains.txt"), settings.domains, new UTF8Encoding(false));
                                }
                                if (settings.enabled && settings.domains.Length > 0 && !Running()) TryStart();
                                if ((!settings.enabled || settings.domains.Length == 0) && Running()) StopEngine();
                                result = new { ok = true, running = Running(), enabled = settings.enabled, profile = settings.profile, domainCount = settings.domains.Length, errorDetail = lastError, version = "0.1.0" };
                            }
                        } catch (Exception e) { result = new { ok = false, error = e.Message }; }
                        Protocol.Write(pipe, result);
                    }
                } catch (Exception e) { if (!stopping) Log("Control: " + e.Message); }
            }
        }
        private bool Running() { return engine != null && !engine.HasExited; }
        private void TryStart() {
            try { StartEngine(); } catch (Exception e) { lastError = e.Message; Log(lastError); StopEngine(); }
        }
        private void StartEngine() {
            if (Running()) return;
            // Existing standalone GoodbyeDPI and a second packet filter must not compete.
            if (Process.GetProcessesByName("goodbyedpi").Length > 0) throw new InvalidOperationException("Another GoodbyeDPI instance is running. Stop it before enabling Companion.");
            StopEngine();
            string folder = Path.Combine(Program.Home, "engine", Environment.Is64BitOperatingSystem ? "x86_64" : "x86");
            string executable = Path.Combine(folder, "goodbyedpi.exe");
            string list = Path.Combine(dataPath, "domains.txt");
            File.WriteAllLines(list, settings.domains, new UTF8Encoding(false));
            job = Jobs.Create();
            engine = new Process { StartInfo = new ProcessStartInfo(executable, Policy.Profiles[settings.profile] + " --blacklist \"" + list + "\"") {
                WorkingDirectory = folder, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true
            }};
            engine.OutputDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
            engine.ErrorDataReceived += (s, e) => { if (e.Data != null) Log(e.Data); };
            engine.Start();
            if (!Jobs.AssignProcessToJobObject(job, engine.Handle)) throw new IOException("Cannot isolate engine process: " + Marshal.GetLastWin32Error());
            engine.BeginOutputReadLine(); engine.BeginErrorReadLine();
            if (engine.WaitForExit(700)) throw new IOException("Engine exited with code " + engine.ExitCode + ". See engine.log.");
            lastError = "";
        }
        private void StopEngine() {
            try { if (engine != null && !engine.HasExited) { engine.Kill(); engine.WaitForExit(3000); } } catch (Exception e) { Log("Stop: " + e.Message); }
            if (engine != null) { engine.Dispose(); engine = null; }
            if (job != IntPtr.Zero) { Jobs.CloseHandle(job); job = IntPtr.Zero; }
        }
        private void Log(string text) {
            lock (logGate) {
                try {
                    string path = Path.Combine(dataPath, "engine.log");
                    if (File.Exists(path) && new FileInfo(path).Length > 1048576) File.WriteAllText(path, "");
                    File.AppendAllText(path, DateTime.UtcNow.ToString("o") + " " + text + Environment.NewLine);
                } catch { }
            }
        }
    }
    internal static class Jobs {
        [StructLayout(LayoutKind.Sequential)] private struct Basic {
            public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking; public uint Active; public UIntPtr Affinity; public uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] private struct Io { public ulong R1, W1, O1, R2, W2, O2; }
        [StructLayout(LayoutKind.Sequential)] private struct Extended { public Basic Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int info, ref Extended data, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
        public static IntPtr Create() {
            IntPtr handle = CreateJobObject(IntPtr.Zero, null);
            var data = new Extended(); data.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
            if (handle == IntPtr.Zero || !SetInformationJobObject(handle, 9, ref data, (uint)Marshal.SizeOf(data))) {
                if (handle != IntPtr.Zero) CloseHandle(handle);
                throw new IOException("Cannot create engine job");
            }
            return handle;
        }
    }
}
