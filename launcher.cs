using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

namespace FolioScript
{
    class Program
    {
        static bool IsServerAlive()
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:5173/");
                request.Timeout = 600;
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    return response.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        static void Main(string[] args)
        {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string serverScript = Path.Combine(appDir, "server.cjs");

            if (!IsServerAlive())
            {
                string nodePath = @"C:\Program Files\nodejs\node.exe";
                if (!File.Exists(nodePath)) nodePath = "node.exe";

                ProcessStartInfo serverInfo = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "\"" + serverScript + "\"",
                    WorkingDirectory = appDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                try
                {
                    Process.Start(serverInfo);
                }
                catch { }

                for (int i = 0; i < 30; i++)
                {
                    if (IsServerAlive()) break;
                    Thread.Sleep(100);
                }
            }

            string browserPath = @"C:\Program Files\Google\Chrome\Application\chrome.exe";
            if (!File.Exists(browserPath))
            {
                browserPath = @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe";
            }
            if (!File.Exists(browserPath))
            {
                browserPath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            }
            if (!File.Exists(browserPath))
            {
                browserPath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
            }

            string appArgs = "--app=\"http://127.0.0.1:5173/?v=fs5\" --window-size=1280,820";

            ProcessStartInfo windowInfo = new ProcessStartInfo
            {
                FileName = browserPath,
                Arguments = appArgs,
                UseShellExecute = true
            };

            try
            {
                Process.Start(windowInfo);
            }
            catch { }
        }
    }
}