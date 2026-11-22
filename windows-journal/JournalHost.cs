using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class JournalHost
{
    const int MaxMessage = 128 * 1024;
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxMessage * 2, RecursionLimit = 24 };
    static readonly HashSet<string> Actions = new HashSet<string> {
        "WAITLIST", "INSERT_VISIT", "DELETE_VISIT", "UPSERT_RESERVATION", "DELETE_RESERVATION"
    };

    public static int Main(string[] args)
    {
        string directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Grupo Qu4tro", "Diario CRM");
        bool maintenance = args.Length == 1 && args[0] == "--maintenance";
        try {
            if (maintenance) {
                Run(directory, new Dictionary<string, object> { { "command", "status" } });
                return 0;
            }
            using (var reader = new BinaryReader(Console.OpenStandardInput()))
            using (var writer = new BinaryWriter(Console.OpenStandardOutput())) {
                object response;
                try {
                    int size = reader.ReadInt32();
                    if (size <= 0 || size > MaxMessage) throw new InvalidDataException();
                    byte[] message = reader.ReadBytes(size);
                    if (message.Length != size) throw new EndOfStreamException();
                    response = Run(directory, Json.Deserialize<Dictionary<string, object>>(Utf8.GetString(message)));
                } catch (Exception) {
                    response = new { ok = false, error = "Não foi possível gravar ou verificar o diário do Windows." };
                }
                byte[] result = Utf8.GetBytes(Json.Serialize(response));
                writer.Write(result.Length);
                writer.Write(result);
                writer.Flush();
            }
            return 0;
        } catch (Exception) {
            return 1;
        }
    }

    static object Run(string directory, Dictionary<string, object> message)
    {
        string command = Required(message, "command", 24);
        var now = DateTimeOffset.UtcNow;
        string sid = System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
        using (var mutex = new Mutex(false, @"Global\Qu4troCRMJournal-" + sid)) {
            bool acquired;
            try { acquired = mutex.WaitOne(TimeSpan.FromSeconds(8)); }
            catch (AbandonedMutexException) { acquired = true; }
            if (!acquired) throw new IOException("Diário ocupado.");
            try {
                Directory.CreateDirectory(directory);
                string path = Path.Combine(directory, "operacoes.jsonl");
                string staging = path + ".tmp";
                if (File.Exists(staging)) File.Delete(staging);
                var rows = new List<Dictionary<string, object>>();
                bool dirty = false;
                if (File.Exists(path)) {
                    foreach (string line in File.ReadLines(path, Utf8)) {
                        var row = Json.Deserialize<Dictionary<string, object>>(line);
                        if (Date(row, "createdAt") <= now.AddHours(-72)) dirty = true;
                        else rows.Add(row);
                    }
                }

                if (command == "append" || command == "confirm") {
                    Guid id;
                    if (!Guid.TryParseExact(Required(message, "id", 36), "D", out id)) throw new InvalidDataException();
                    string key = id.ToString("D");
                    var existing = rows.SingleOrDefault(row => (string)row["id"] == key);
                    if (command == "append") {
                        string action = Required(message, "action", 24);
                        if (!Actions.Contains(action)) throw new InvalidDataException();
                        var payload = message["details"] as Dictionary<string, object>;
                        if (payload == null) throw new InvalidDataException();
                        byte[] protectedData = ProtectedData.Protect(Utf8.GetBytes(Json.Serialize(payload)), id.ToByteArray(), DataProtectionScope.CurrentUser);
                        if (existing == null) {
                            rows.Add(new Dictionary<string, object> {
                                {"id", key}, {"createdAt", now.ToString("o", CultureInfo.InvariantCulture)},
                                {"action", action}, {"confirmedAt", null}, {"encrypted", Convert.ToBase64String(protectedData)}
                            });
                            dirty = true;
                        } else {
                            var prior = ProtectedData.Unprotect(Convert.FromBase64String((string)existing["encrypted"]), id.ToByteArray(), DataProtectionScope.CurrentUser);
                            if ((string)existing["action"] != action || Utf8.GetString(prior) != Json.Serialize(payload))
                                throw new InvalidDataException("Identificador usado por outra operação.");
                        }
                    } else if (existing != null && existing["confirmedAt"] == null) {
                        existing["confirmedAt"] = now.ToString("o", CultureInfo.InvariantCulture);
                        dirty = true;
                    }
                } else if (command != "status") {
                    throw new InvalidDataException();
                }

                if (dirty) {

                    using (var stream = new FileStream(staging, FileMode.Create, FileAccess.Write, FileShare.None))
                    using (var writer = new StreamWriter(stream, Utf8)) {
                        foreach (var row in rows) writer.WriteLine(Json.Serialize(row));
                        writer.Flush();
                        stream.Flush(true);
                    }
                    if (File.Exists(path)) File.Replace(staging, path, null);
                    else File.Move(staging, path);
                }
                int expiring = rows.Count(row => row["confirmedAt"] == null && Date(row, "createdAt") <= now.AddHours(-60));
                return new { ok = true, expiring = expiring };
            } finally { mutex.ReleaseMutex(); }
        }
    }

    static DateTimeOffset Date(Dictionary<string, object> data, string key)
    {
        return DateTimeOffset.Parse(Required(data, key, 50), CultureInfo.InvariantCulture);
    }

    static string Required(Dictionary<string, object> data, string key, int max)
    {
        object raw;
        if (data == null || !data.TryGetValue(key, out raw)) throw new InvalidDataException();
        var value = raw as string;
        if (String.IsNullOrWhiteSpace(value) || value.Length > max) throw new InvalidDataException();
        return value;
    }
}
