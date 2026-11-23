using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class JournalHost
{
    const int MaxMessage = 128 * 1024;
    const string FileName = "operacoes.jsonl";
    internal static readonly string StandardDirectory = Path.Combine(@"C:", "Gestão de Apps Grupo Qu4tro", "Backup_72hs_Gestao_Clientes");
    internal static readonly string LegacyDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Grupo Qu4tro", "Diario CRM");
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxMessage * 2, RecursionLimit = 24 };
    static readonly HashSet<string> Actions = new HashSet<string> {
        "WAITLIST", "INSERT_VISIT", "DELETE_VISIT", "UPSERT_RESERVATION", "DELETE_RESERVATION"
    };

    public static int Main(string[] args)
    {
        bool maintenance = args.Length == 1 && args[0] == "--maintenance";
        try {
            if (maintenance) {
                RunConfigured(new Dictionary<string, object> { { "command", "status" } });
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
                    response = RunConfigured(Json.Deserialize<Dictionary<string, object>>(Utf8.GetString(message)));
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

    internal static object RunConfigured(Dictionary<string, object> message)
    {
        return RunConfigured(StandardDirectory, LegacyDirectory, message);
    }

    internal static object RunConfigured(string standard, string legacy, Dictionary<string, object> message)
    {
        string command = Required(message, "command", 24);
        if (command == "setup") SetupDirectory(standard, legacy);
        string directory = File.Exists(Path.Combine(standard, FileName)) ? standard : legacy;
        if (!File.Exists(Path.Combine(directory, FileName)))
            return new { ok = true, configured = false, storage = "none", expiring = 0 };
        RejectRedirect(Path.GetDirectoryName(directory));
        return Run(directory, command == "setup"
            ? new Dictionary<string, object> { { "command", "status" } } : message,
            directory == standard ? "standard" : "legacy");
    }

    static void RejectRedirect(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("Redirecionamento de arquivos não permitido no diário.");
    }

    static DirectorySecurity PrivateDirectoryAcl()
    {
        var acl = new DirectorySecurity();
        acl.SetAccessRuleProtection(true, false);
        foreach (var sid in new[] {WindowsIdentity.GetCurrent().User, new SecurityIdentifier("S-1-5-18")})
            acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None, AccessControlType.Allow));
        return acl;
    }

    internal static void SetupDirectory(string standard, string legacy)
    {
        string parent = Path.GetDirectoryName(standard);
        Directory.CreateDirectory(parent);
        RejectRedirect(parent);
        Directory.CreateDirectory(standard, PrivateDirectoryAcl());
        RejectRedirect(standard);
        string target = Path.Combine(standard, FileName);
        string previous = Path.Combine(legacy, FileName);
        string staging = Path.Combine(standard, Guid.NewGuid().ToString("N") + ".tmp");
        var now = DateTimeOffset.UtcNow;

        using (var mutex = new Mutex(false, MutexName())) {
            if (!Acquire(mutex)) throw new IOException("Diário ocupado.");
            try {
                VerifyDirectoryWrite(standard);
                var rows = new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);
                foreach (string file in new[] {target, previous}) {
                    if (!File.Exists(file)) continue;
                    RejectRedirect(Path.GetDirectoryName(file));
                    RejectRedirect(file);
                    foreach (string line in File.ReadLines(file, Utf8)) {
                        var row = Json.Deserialize<Dictionary<string, object>>(line);
                        if (Date(row, "createdAt") <= now.AddHours(-72)) continue;
                        string key = Required(row, "id", 36);
                        Guid id = Guid.ParseExact(key, "D");
                        ProtectedData.Unprotect(Convert.FromBase64String((string)row["encrypted"]),
                            id.ToByteArray(), DataProtectionScope.CurrentUser);
                        Dictionary<string, object> old;
                        if (!rows.TryGetValue(key, out old)) rows.Add(key, row);
                        else {
                            if (!Equals(old["encrypted"], row["encrypted"]) ||
                                !Equals(old["action"], row["action"]) || !Equals(old["createdAt"], row["createdAt"]))
                                throw new InvalidDataException("Registros diferentes com o mesmo identificador.");
                            if (old["confirmedAt"] == null && row["confirmedAt"] != null) old["confirmedAt"] = row["confirmedAt"];
                        }
                    }
                }
                WriteJournal(staging, target, rows.Values.OrderBy(row => Date(row, "createdAt")));
            } finally {
                if (File.Exists(staging)) File.Delete(staging);
                mutex.ReleaseMutex();
            }
        }
    }

    static string MutexName()
    {
        return @"Global\Qu4troCRMJournal-" + WindowsIdentity.GetCurrent().User.Value;
    }

    static bool Acquire(Mutex mutex)
    {
        try { return mutex.WaitOne(TimeSpan.FromSeconds(8)); }
        catch (AbandonedMutexException) { return true; }
    }

    static void WriteJournal(string staging, string path, IEnumerable<Dictionary<string, object>> rows)
    {
        using (var stream = new FileStream(staging, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        using (var writer = new StreamWriter(stream, Utf8)) {
            foreach (var row in rows) writer.WriteLine(Json.Serialize(row));
            writer.Flush();
            stream.Flush(true);
        }
        if (File.Exists(path)) File.Replace(staging, path, null);
        else File.Move(staging, path);
    }

    internal static object Run(string directory, Dictionary<string, object> message, string storage = "legacy")
    {
        string command = Required(message, "command", 24);
        var now = DateTimeOffset.UtcNow;
        using (var mutex = new Mutex(false, MutexName())) {
            bool acquired = Acquire(mutex);
            if (!acquired) throw new IOException("Diário ocupado.");
            try {
                Directory.CreateDirectory(directory);
                RejectRedirect(directory);
                string path = Path.Combine(directory, FileName);
                string staging = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".tmp");
                var rows = new List<Dictionary<string, object>>();
                bool dirty = false;
                if (File.Exists(path)) {
                    RejectRedirect(path);
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

                if (command == "status" && rows.Count > 0) {
                    var sample = rows[0];
                    ProtectedData.Unprotect(Convert.FromBase64String((string)sample["encrypted"]),
                        Guid.ParseExact((string)sample["id"], "D").ToByteArray(), DataProtectionScope.CurrentUser);
                }
                if (dirty) {
                    try { WriteJournal(staging, path, rows); }
                    finally { if (File.Exists(staging)) File.Delete(staging); }
                }
                int expiring = rows.Count(row => row["confirmedAt"] == null && Date(row, "createdAt") <= now.AddHours(-60));
                return new { ok = true, configured = true, storage = storage, expiring = expiring };
            } finally { mutex.ReleaseMutex(); }
        }
    }

    static void VerifyDirectoryWrite(string directory)
    {
        string probe = Path.Combine(directory, "verificacao-" + Guid.NewGuid().ToString("N") + ".tmp");
        byte[] content = Utf8.GetBytes("Grupo Qu4tro");
        try {
            byte[] encrypted = ProtectedData.Protect(content, null, DataProtectionScope.CurrentUser);
            using (var stream = new FileStream(probe, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                stream.Write(encrypted, 0, encrypted.Length);
                stream.Flush(true);
            }
            if (!content.SequenceEqual(ProtectedData.Unprotect(File.ReadAllBytes(probe), null, DataProtectionScope.CurrentUser)))
                throw new IOException();
        } finally { if (File.Exists(probe)) File.Delete(probe); }
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
