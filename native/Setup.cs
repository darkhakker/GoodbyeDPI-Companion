using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Drawing;

internal static class Setup {
    private const string Prefix = "GoodbyeDPI-Companion-Windows/";
    [STAThread]
    private static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--verify-payload") {
            try { using (var zip = OpenPayload()) { Verify(zip); } return 0; } catch { return 1; }
        }
        bool created;
        using (var mutex = new Mutex(true, "Local\\GoodbyeDPICompanionSetup", out created)) {
            if (!created) { MessageBox.Show("Установщик уже запущен.", "GoodbyeDPI Companion"); return 0; }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var window = new SetupWindow()) { Application.Run(window); return window.Succeeded ? 0 : 1; }
        }
    }
    private static ZipArchive OpenPayload() {
        var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Payload.zip");
        if (stream == null) throw new InvalidDataException("Installer payload missing");
        return new ZipArchive(stream, ZipArchiveMode.Read);
    }
    private static void Verify(ZipArchive zip) {
        var files = zip.Entries.Where(e => !e.FullName.EndsWith("/")).ToDictionary(e => e.FullName.Replace('\\', '/'), StringComparer.OrdinalIgnoreCase);
        ZipArchiveEntry manifest;
        if (!files.TryGetValue(Prefix + "checksums.json", out manifest)) throw new InvalidDataException("Checksums missing");
        Dictionary<string, string> hashes;
        using (var reader = new StreamReader(manifest.Open())) { hashes = new JavaScriptSerializer().Deserialize<Dictionary<string, string>>(reader.ReadToEnd()); }
        foreach (string required in new [] { "Install.ps1", "Companion.exe", "public_suffix_list.dat", "store-extension-id.txt", "engine\\x86_64\\goodbyedpi.exe", "engine\\x86_64\\WinDivert64.sys", "engine\\x86\\goodbyedpi.exe", "engine\\x86\\WinDivert32.sys" }) {
            if (!hashes.ContainsKey(required)) throw new InvalidDataException("Required component missing: " + required);
        }
        foreach (var pair in hashes) {
            string name = pair.Key.Replace('\\', '/');
            if (name.StartsWith("/") || name.Split('/').Any(p => p == ".." || p == ".") || name.Contains(":")) throw new InvalidDataException("Invalid payload path");
            ZipArchiveEntry entry;
            if (!files.TryGetValue(Prefix + name, out entry)) throw new InvalidDataException("Missing component: " + name);
            using (var sha = SHA256.Create()) using (var input = entry.Open()) {
                string digest = BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "");
                if (!String.Equals(digest, pair.Value, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Checksum mismatch: " + name);
            }
        }
    }
    private static string Extract() {
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GoodbyeDPICompanion", "Setup", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        using (var zip = OpenPayload()) {
            Verify(zip);
            foreach (var entry in zip.Entries) {
                string relative = entry.FullName.Replace('\\', '/');
                string file = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
                if (!file.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Invalid extraction path");
                if (relative.EndsWith("/")) { Directory.CreateDirectory(file); continue; }
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                using (var input = entry.Open()) using (var output = new FileStream(file, FileMode.CreateNew, FileAccess.Write)) { input.CopyTo(output); }
            }
        }
        return Path.Combine(root, "GoodbyeDPI-Companion-Windows");
    }
    private sealed class SetupWindow : Form {
        private readonly Label title = new Label();
        private readonly Label detail = new Label();
        private readonly ProgressBar progress = new ProgressBar();
        private readonly Button close = new Button();
        private readonly Button openLog = new Button();
        private readonly Button storeButton = new Button();
        private readonly TextBox logText = new TextBox();
        private string logPath;
        private bool finished;
        public bool Succeeded { get; private set; }
        public SetupWindow() {
            Text = "GoodbyeDPI Companion"; ClientSize = new Size(620, 430);
            StartPosition = FormStartPosition.CenterScreen; FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false; MinimizeBox = false;
            title.SetBounds(24, 24, 572, 35); title.Font = new Font("Segoe UI", 15, FontStyle.Bold); title.Text = "Установка компонентов";
            detail.SetBounds(24, 70, 572, 65); detail.Font = new Font("Segoe UI", 10); detail.Text = "Подготавливаем файлы. Подтвердите запрос администратора Windows, когда он появится.";
            progress.SetBounds(24, 145, 572, 18); progress.Style = ProgressBarStyle.Marquee;
            logText.SetBounds(24, 175, 572, 190); logText.Multiline = true; logText.ReadOnly = true; logText.ScrollBars = ScrollBars.Vertical; logText.Visible = false;
            openLog.SetBounds(24, 389, 160, 30); openLog.Text = "Открыть журнал"; openLog.Visible = false;
            openLog.Click += (s, e) => { if (File.Exists(logPath)) Process.Start(new ProcessStartInfo("notepad.exe", "\"" + logPath + "\"") { UseShellExecute = false }); };
            storeButton.SetBounds(24, 389, 260, 30); storeButton.Text = "Страница расширения в Chrome"; storeButton.Visible = false;
            storeButton.Click += (s, e) => Process.Start(new ProcessStartInfo("https://chromewebstore.google.com/detail/" + GoodbyeDPICompanion.BuildInfo.StoreExtensionId) { UseShellExecute = true });
            close.SetBounds(476, 389, 120, 30); close.Text = "Закрыть"; close.Enabled = false; close.Click += (s, e) => Close();
            Controls.AddRange(new Control[] { title, detail, progress, logText, openLog, storeButton, close });
            FormClosing += (s, e) => { if (!finished) e.Cancel = true; };
            Shown += (s, e) => ThreadPool.QueueUserWorkItem(_ => Install());
        }
        private void Install() {
            string folder = null, failure = null;
            try {
                folder = Extract();
                logPath = Path.Combine(folder, "install.log");
                string script = Path.Combine(folder, "Install.ps1").Replace("'", "''");
                string command = "& '" + script + "' -LogPath '" + logPath.Replace("'", "''") + "'";
                string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(command));
                var start = new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -EncodedCommand " + encoded) {
                    UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = folder
                };
                using (var process = Process.Start(start)) {
                    process.WaitForExit();
                    if (process.ExitCode != 0) throw new InvalidOperationException("Установка отменена или завершилась ошибкой.");
                }
            } catch (Exception e) { failure = e.Message; }
            BeginInvoke(new Action(() => {
                finished = true; Succeeded = failure == null; progress.Style = ProgressBarStyle.Blocks; progress.Value = failure == null ? 100 : 0; close.Enabled = true;
                title.Text = failure == null ? "Готово" : "Не удалось установить";
                storeButton.Visible = failure == null;
                detail.Text = failure == null ? "Компоненты установлены. Вернитесь в расширение, добавьте сайт и включите обход." : failure + " Подробности приведены ниже.";
                if (failure != null) {
                    logText.Visible = true; openLog.Visible = File.Exists(logPath);
                    try { logText.Text = File.Exists(logPath) ? File.ReadAllText(logPath) : failure; } catch { logText.Text = failure; }
                }
            }));
        }
    }
}
