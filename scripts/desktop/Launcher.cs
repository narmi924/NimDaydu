using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

internal static class Launcher
{
#if START
    const string Script = "start.ps1";
    const string Working = "正在启动本机字幕服务…";
    const string Done = "字幕服务已就绪，可以打开 Chrome 字幕。";
#else
    const string Script = "stop.ps1";
    const string Working = "正在关闭本机字幕服务…";
    const string Done = "字幕服务已关闭。";
#endif

    static void RunScript()
    {
        string project;
        using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("project.txt")))
            project = reader.ReadToEnd();
        if (!File.Exists(Path.Combine(project, Script)))
            throw new FileNotFoundException("找不到项目。请在 NimDaydu 文件夹重新运行 scripts\\Install-DesktopLaunchers.ps1。");

        // A second desktop click waits for the first start or stop to finish.
        using (var gate = new Mutex(false, @"Local\NimDayduDesktopControl"))
        {
            try { gate.WaitOne(); }
            catch (AbandonedMutexException) { /* The previous launcher exited while holding the mutex. */ }
            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe"),
                    Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\\" + Script,
                    WorkingDirectory = project,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardError = true
                };
                using (var process = Process.Start(info))
                {
                    string error = process.StandardError.ReadToEnd();
                    process.WaitForExit();
                    if (process.ExitCode != 0)
                        throw new InvalidOperationException(String.IsNullOrWhiteSpace(error) ? Script + " 执行失败。" : error.Trim());
                }
            }
            finally { gate.ReleaseMutex(); }
        }
    }

    [STAThread]
    static int Main()
    {
        Application.EnableVisualStyles();
        using (var window = new Form())
        {
            window.Text = "NimDaydu";
            window.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            window.StartPosition = FormStartPosition.CenterScreen;
            window.FormBorderStyle = FormBorderStyle.FixedDialog;
            window.ControlBox = false;
            window.ClientSize = new Size(330, 70);
            var status = new Label { Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleCenter, Text = Working };
            window.Controls.Add(status);
            int result = 1;
            window.Shown += async delegate
            {
                try
                {
                    await Task.Run((Action)RunScript);
                    result = 0;
                    status.Text = Done;
                    await Task.Delay(1700);
                }
                catch (Exception error)
                {
                    MessageBox.Show(window, error.Message, "NimDaydu", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                window.Close();
            };
            Application.Run(window);
            return result;
        }
    }
}
