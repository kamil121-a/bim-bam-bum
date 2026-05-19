# Backup użytkowników — harmonogram (Windows)

Skrypt **`backup-users.mjs`** zapisuje do pliku JSON:

- wszystkie wiersze z tabeli **`profiles`**,
- listę użytkowników **Auth** (id, email, daty, metadata) — bez haseł.

## Uruchomienie ręczne

```powershell
npm run backup:users
```

Własna ścieżka:

```powershell
node scripts/backup-users.mjs --out D:\kopie\wealthtracker-users.json
```

Zmienna środowiskowa:

```powershell
$env:BACKUP_USERS_OUT="D:\kopie\users.json"; npm run backup:users
```

Przy każdym udanym zapisie poprzednia wersja jest kopiowana do **`*.previous.json`**.

---

## Co 3 dni o wybranej godzinie (Harmonogram zadań)

1. **Harmonogram zadań** → **Utwórz zadanie…**
2. **Wyzwalacz:** codziennie (lub „co 3 dni”, jeśli dostępne), godzina np. **03:15**.
3. **Działanie:** program `npm`, argumenty `run backup:users`, folder startowy = katalog projektu.

### Przykład `schtasks` (PowerShell)

Dostosuj ścieżkę i godzinę (`/ST`):

```powershell
schtasks /Create /TN "WealthTrackerUserBackup" /TR "cmd /c cd /d C:\Users\HP\Desktop\moneyrank && npm run backup:users" /SC DAILY /MO 3 /ST 03:15 /RU "%USERNAME%"
```

`/MO 3` przy `/SC DAILY` oznacza powtarzanie co **3** dni (zależnie od wersji Windows sprawdź w GUI).

---

## Bezpieczeństwo

Kopia zawiera **emaile i nicki** — nie commituj pliku do git (`backups/` jest ignorowane).
