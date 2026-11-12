# Disboard — prywatny tracker anime

Tracker anime działający w całości w przeglądarce. Dane o anime pobiera sam z AniList i MyAnimeList. Liczy dokładny czas oglądania razem z rewatchami. Pokazuje premiery i harmonogram odcinków, a na stronie głównej ma centrum **No Game No Life** z licznikiem „Jak długo czekam na drugi sezon No Game No Life”.

Nie potrzebuje serwera ani płatnego hostingu.

---

## Uruchomienie

### Opcja A: GitHub Pages (polecana, darmowa, z automatycznym feedem newsów)

1. Załóż konto na github.com i utwórz nowe repozytorium, np. `disboard` (publiczne).
2. Wgraj **zawartość** tego folderu do repozytorium. Najprościej przez *Add file → Upload files*: przeciągnij wszystkie pliki i foldery, także `.github`.
   Folder `.github` bywa ukryty w systemie. Jeśli go nie widzisz, włącz pokazywanie ukrytych plików albo dodaj plik `.github/workflows/ngnl-feed.yml` ręcznie przez *Add file → Create new file*.
3. Wejdź w *Settings → Pages*. W „Source” wybierz *Deploy from a branch*, gałąź `main`, folder `/ (root)` i kliknij *Save*.
4. Po 1–2 minutach aplikacja będzie pod adresem `https://TWÓJ-LOGIN.github.io/disboard/`.
5. Feed newsów NGNL: wejdź w zakładkę *Actions*, wybierz „Feed NGNL” i kliknij *Run workflow*. Potem workflow uruchamia się sam co 4 godziny.
   Jeśli krok „Zapisz zmiany” kończy się błędem uprawnień, ustaw *Settings → Actions → General → Workflow permissions* na **Read and write permissions**.

Na telefonie otwórz ten adres i wybierz „Dodaj do ekranu głównego”. Aplikacja uruchomi się wtedy jak zwykła aplikacja, bez paska przeglądarki.

### Opcja B: Netlify Drop (30 sekund, bez konta GitHub)

Przeciągnij cały folder na https://app.netlify.com/drop. Wszystko działa poza automatycznym feedem RSS, bo ten wymaga GitHub Actions. Newsy o NGNL z MyAnimeList działają normalnie.

### Opcja C: lokalnie z dysku

Kliknij dwukrotnie `index.html`. Tracker, wyszukiwarka, premiery, statystyki i newsy z MyAnimeList działają. Z dysku nie wczyta się tylko lokalny plik feedu i nie działa tryb offline aplikacji. Pełną wersję lokalnie uruchomisz poleceniem `python -m http.server` w tym folderze i otwarciem `http://localhost:8000`.

---

## Gdzie są moje dane i jak ich nie stracić

- Lista, historia i rewatche zapisują się **w przeglądarce, w której ich używasz**. Nic nie trafia na żaden serwer.
- Lista leży w bazie IndexedDB przeglądarki, więc nie ma limitu ok. 5 MB z localStorage. Starsze wersje trzymały ją w localStorage: przy pierwszym uruchomieniu nowej wersji lista przenosi się sama, stara kopia zostaje nietknięta, a w *Ustawienia i kopie* pojawia się kopia „Sprzed przeniesienia do IndexedDB”. W sekcji „O aplikacji” widać, gdzie lista jest zapisana.
- **Telefon i komputer mają osobne listy.** Przenosisz je eksportem JSON na jednym urządzeniu i importem na drugim (*Ustawienia i kopie*).
- Aplikacja sama robi kopię w przeglądarce raz na godzinę i trzyma ją 7 dni. To chroni przed pomyłką, ale nie przed wyczyszczeniem danych przeglądarki.
- **Regularnie rób eksport JSON.** Po 2 tygodniach bez kopii aplikacja sama o tym przypomni. Plik JSON odtwarza wszystko: sesje, rewatche, daty i notatki.
- **Kilka kart naraz jest bezpieczne.** Zmiana w jednej karcie od razu pojawia się w pozostałych, np. plus na wynikach wyszukiwania zamienia się w status. Gdy dwie karty zapiszą prawie jednocześnie, zmiany łączą się tytuł po tytule. Przy sporze o to samo anime wygrywa nowsza zmiana. Karta leżąca w tle niczego już nie nadpisze.
- Awaria AniList nie psuje listy. Każdy wpis ma zapisaną kopię danych, a aplikacja pokazuje wtedy ostatnio pobrane informacje z oznaczeniem daty.

Eksport jest dostępny w trzech formatach:

| Format | Do czego |
|---|---|
| JSON | pełna kopia zapasowa, import 1:1 |
| CSV | Excel (średniki i polskie znaki działają od razu) |
| XML | format MyAnimeList, do importu na MAL lub AniList |

Import obsługuje JSON z tej aplikacji, eksport XML z MyAnimeList oraz CSV z kolumną „AniList ID” lub „MAL ID”.

---

## Uzupełnianie listy o anime obejrzane dawniej

- **Tryb uzupełniania** (*Ustawienia i kopie* albo skrót **Alt+U** na każdej stronie). Gdy jest włączony, odcinki, ukończenia i rewatche zapisują się bez daty, a „+” na okładkach dodaje tytuł od razu jako „Obejrzane”. U góry widać złotą pigułkę: kliknięcie jej albo ponowne Alt+U wyłącza tryb.
- **Przenieś obejrzenia do przeszłości** (*Ustawienia i kopie*). Wybierasz w kalendarzu zakres „od–do” albo skrót (Dziś, Ostatnie 7 dni, Od początku) i odznaczasz anime, które naprawdę oglądałeś w tym czasie. Odcinki z tego zakresu tracą datę: znikają z wykresów miesięcznych i z „ostatnio obejrzanych”, ale nadal liczą się do łącznego czasu, liczby odcinków i rewatchy. Statusy, postęp, oceny i notatki zostają bez zmian, a obejrzenia z ręcznie wpisaną datą nie są ruszane. Ostatnie przeniesienie można cofnąć, także po przeładowaniu strony.

## Szukanie bez klikania

Na komputerze wystarczy zacząć pisać tytuł na dowolnej stronie: aplikacja sama przeniesie Cię do wyszukiwarki z wpisanymi literami, nawet przy szybkim pisaniu. Jeśli pole wyszukiwania nie jest aktywne (np. po dodaniu anime z wyników), nowe pisanie zaczyna wyszukiwanie od zera. Klawisz „/” otwiera pustą wyszukiwarkę. Lupa dalej działa. Pisanie w innych polach, skróty z Ctrl i Alt+U działają po staremu.

## Szybkie dodawanie z kart

- **Klik w „+”** na okładce dodaje do Planuję, a w trybie uzupełniania do Obejrzanych.
- **Najechanie myszką na „+”** otwiera po chwili menu statusów: Planuję, Oglądam, Obejrzane, Wstrzymane, Porzucone. Na telefonie menu otwiera przytrzymanie plusa.
- **„Oglądam”** pyta o numer odcinka. Wpisz go i zatwierdź Enterem albo pomiń.
- **Klawiatura:** w otwartym menu klawisze 1–5 wybierają status, Esc zamyka, a strzałka w dół na „+” otwiera menu.
- **Odznaka statusu** na dodanej karcie otwiera to samo menu: zmienisz status albo usuniesz tytuł z listy, bez wchodzenia na stronę anime.

## Skaner kadrów (trace.moe)

Zakładka *Skaner kadrów* rozpoznaje anime ze zrzutu ekranu: podaje serię, odcinek i minutę. Obrazek wybierasz kliknięciem, przeciągasz, wklejasz Ctrl+V albo podajesz link. Wynik dodasz od razu na listę: przyciskiem z menu statusów albo „Oglądam od odc. N”, który ustawia postęp na poprzedni odcinek.

- **Limit:** bez konta trace.moe pozwala na około 100 wyszukiwań w oknie 24 godzin, liczonych dla Twojego adresu IP. Licznik w skanerze pokazuje, ile zostało, ile wykorzystałeś dziś i kiedy odnowi się najstarsze wyszukiwanie.
- **Historia:** ostatnie 12 skanów zapisuje się w przeglądarce. Ponowne otwarcie wyniku nie zużywa limitu.
- **Wiarygodność:** poniżej 90% podobieństwa wynik zwykle jest błędny. Najlepiej działają kadry bez napisów, logo i czarnych pasów.

## Tłumacz wiadomości NGNL

Japońskie nagłówki w centrum NGNL tłumaczą się same na angielski, a oryginał zostaje pod spodem. Przy każdej japońskiej wiadomości jest link „Czytaj artykuł po angielsku” przez Google Tłumacza.

- **W Chrome 138+ na komputerze** tłumaczy wbudowany tłumacz przeglądarki: lokalnie i bez limitu. Model pobiera się raz, po kliknięciu „Włącz tłumacza Chrome”.
- **W innych przeglądarkach** tłumaczy MyMemory, około 5000 znaków dziennie. Każdy nagłówek tłumaczy się tylko raz, bo wynik zostaje w pamięci.
- Tłumacza wyłączysz w *Ustawienia i kopie → Wyświetlanie*.

## Sortowanie i filtrowanie listy

- **25 sposobów sortowania** w trzech grupach. *Twoje dane:* ostatnio zmieniane, ostatnio oglądane, daty dodania, rozpoczęcia i ukończenia, ocena, ocena kontra AniList, postęp, zostało odcinków, czas oglądania, liczba obejrzeń. *Oceny w kategoriach:* fabuła, postacie, animacja, muzyka, frajda. *Dane anime:* tytuł, data premiery, średnia i popularność na AniList, liczba odcinków, długość całej serii, format, status emisji, najbliższy odcinek.
- **Przycisk kierunku** obok sortowania odwraca kolejność, a jego podpis mówi, co jest na górze (np. „Najnowsze” albo „Najkrótsze”).
- **Wartość sortowania na karcie**: przy sortowaniu po premierze widzisz „Wiosna 2014”, po średniej „AniList 7,7”. Pozycje bez danej wartości lądują na końcu, a podsumowanie nad listą mówi, ile ich jest.
- **Każda zakładka pamięta własne sortowanie.** Na start: Oglądam po ostatnio oglądanych, Planuję po dacie dodania, Obejrzane po dacie ukończenia, Ulubione po ocenie.
- **Filtr** obok wyszukiwania: gatunki z AniList, format (TV, film, OVA…) i Twoje własne tagi, z liczbą tytułów w bieżącej zakładce.

## Radar kontynuacji

Zakładka **Kontynuacje** w *Mojej liście* pilnuje kontynuacji anime ze statusem Obejrzane i Oglądam. Raz dziennie sprawdza relacje w AniList i pokazuje następny krok w każdej serii, którego nie masz jeszcze na liście. Są trzy grupy: *Już wyszło*, *W emisji* (z odliczaniem) i *Zapowiedziane* (z datą).

- To osobna lista. Nie liczy się do „Wszystkie”, statystyk ani czasu. Tytuł trafia na listę dopiero po kliknięciu „+”.
- Domyślnie widać sezony i filmy. OVA, specjale i historie poboczne włączysz przełącznikiem.
- „Nie interesuje mnie” chowa pozycję, a schowane da się przywrócić na dole.
- Nowa zapowiedź, data premiery albo start emisji kontynuacji dają powiadomienie (rodzaj „Kontynuacja” w Ustawieniach). Pierwszy skan niczego nie ogłasza.
- Na stronie głównej jest kafelek radaru z liczbą nowych pozycji.

## Odcinki, fillery i wybrane odcinki

Strona anime ma zwiniętą sekcję **Odcinki**: mapę serii (fabuła, filler, recap, a obejrzane podświetlone) i skrót typu „220 odcinków · 91 fillerów”. Po rozwinięciu:

- Odcinki są po 50 na stronę, na telefonie po 25. Otwiera się strona z Twoim następnym odcinkiem. Są filtry i pole „idź do odcinka”.
- Każdy odcinek ma kadr, tytuł, datę emisji i ocenę z MAL (1–5) oraz plakietki FILLER i RECAP.
- **Zaznaczanie dowolnych odcinków:** ptaszek, Shift+klik na zakres albo pole „od–do”. Obejrzenie może mieć np. tylko odcinki 272–291. Czas i statystyki liczą wtedy tylko zaznaczone. Domyślnie zapisują się bez daty, a przełącznik „z dzisiejszą datą” to zmienia.
- Dane: kadry, tytuły i daty z ani.zip (TheTVDB) i AniList, fillery, recapy i oceny z MyAnimeList przez Jikan. Oznaczenia fillerów wpisują użytkownicy MAL.

**Pomijanie fillerów** (Ustawienia albo **Alt+P**): plusik przeskakuje fillery i recapy, a pominięte odcinki nie liczą się do czasu. Dojście do ostatniego odcinka kończy serię, nawet z pominiętymi fillerami. W statystykach dla nerda sekcja **Fillery** pokazuje obejrzane fillery, czas na nie, recapy, najbardziej fillerową serię i czas zaoszczędzony dzięki pomijaniu.

## Kolejność oglądania serii

Na stronie anime, w miejscu dawnej sekcji „Powiązane”, jest cała seria w kolejności premier. Aplikacja idzie po relacjach AniList w głąb (prequel prequela, sequel sequela, historie poboczne), zwykle w 2–4 zapytaniach, i trzyma wynik 7 dni.

- **Sezony i filmy** są ponumerowane, a OVA i specjale wiszą pod sezonem, po którym wyszły.
- Przy każdej pozycji jest **Twój status** (klik otwiera menu statusów) albo **„+”**. Otwarte anime ma znacznik „tu jesteś”.
- **Na górze:** ile z serii już obejrzałeś, ile czasu zostało i przycisk „Dodaj brakujące do Planuję” z możliwością cofnięcia.
- **Wersje alternatywne, spin-offy, manga i light novel** są osobno pod spodem.
- To kolejność premier, nie chronologia fabuły. Gdy prequel wyszedł później (jak film Zero), pozycja ma dopisek „fabularnie dzieje się przed…”.

## Oś czasu No Game No Life

Na dole centrum NGNL jest oś czasu całej serii: 13 tomów light novel, manga (Mashiro Hiiragi i „Eastern Union”), spin-offy „Desu!” i „Practical War Game”, 12 odcinków i 6 mini OVA, film Zero, doujinshi autora „No Work No Life” oraz ważne zapowiedzi i wydania Blu-ray. Daty są japońskie, przy tomach także angielskie, a każda pozycja ma link do źródła. Dane sprawdziłem 30 września 2026. Zapowiedź 2. sezonu dopisze się sama z AniList, a Twoje obejrzenia z datą pojawiają się na osi jako „Ty”.

## Oceny szczegółowe

Na stronie anime przycisk *Oceń szczegółowo* otwiera pięć suwaków: fabuła, postacie, animacja, muzyka i dźwięk, frajda (0,5–10). Ocena ogólna liczy się sama jako średnia ocenionych kategorii. Możesz ją też wybrać ręcznie: wtedy aplikacja pokazuje obok średnią kategorii i przycisk *Licz ze średniej*.

Pod suwakami jest porównanie z AniList: średnia społeczności, różnica względem Twojej oceny, rozkład głosów z zaznaczonym Twoim przedziałem i odsetek głosów niższych od Twojego. Kategorie trafiają do eksportu CSV jako kolumny „Ocena: Fabuła” i dalej, a CSV z tymi kolumnami da się zaimportować.

## Postacie, seiyū i twórcy

Strona anime ma sekcję *Postacie i obsada*: postacie z japońskimi aktorami głosowymi i zakładkę z twórcami. Serduszko przy postaci dodaje ją do ulubionych. Kliknięcie aktora albo twórcy otwiera jego stronę: dane z AniList, anime z Twojej listy, w których występuje, i wszystkie role w anime z szybkim dodawaniem.

## Statystyki dla nerda

*Statystyki → Dla nerda* (aplikacja pamięta ostatnią zakładkę). Każdy kafelek ma „?”, które mówi, jak liczba powstała.

- **Rytm:** kalendarz oglądania z 53 tygodni, pora doby, dni tygodnia, maratony, serie dni z rzędu, rekordowy dzień. Liczą się tylko odcinki oznaczane na bieżąco: hurtowe „Obejrzane” i obejrzenia dopisane wstecz nie mówią, kiedy oglądałeś.
- **Biblioteka:** formaty, lata premier, długość serii, gatunki (także te jeszcze nieruszone), studia, źródła, tagi, indeks hipstera i miejsca w rankingach AniList.
- **Ludzie:** ulubiony seiyū, najczęstsze głosy, reżyserzy, autorzy, scenarzyści, projektanci postaci, kompozytorzy i ulubione postacie.
- **Oceny:** rozkład, średnia, rozrzut, Ty kontra AniList, zgodność gustu (korelacja), percentyl społeczności, średnie i najlepsze tytuły w kategoriach.
- **Nawyki, Przeliczniki, Kącik NGNL:** czas ukończenia, porzucanie, prognoza Planuję, rewatche, Twój czas w obejrzeniach NGNL i lotach do Tokio, a na górze ciekawostka dnia z przyciskiem *Losuj*.

Obsadę, twórców, studia, tagi i rankingi aplikacja pobiera z AniList w tle przy pierwszym wejściu, po kilka tytułów na zapytanie, i trzyma je 30 dni. Przy długiej liście zajmuje to chwilę, a pasek na górze pokazuje postęp.

## Wygląd i bajery

W *Ustawienia i kopie → Wygląd i bajery* wybierasz jeden z sześciu ciemnych motywów:
- **Disboard** (domyślny);
- **Ex Machina**: chłodny granat z siatką obwodów;
- **Flügel**: śliwka ze złotą aureolą;
- **Werebeast**: ciepły brąz i bursztyn;
- **Zero**: popiół, a okładki odzyskują kolor dopiero pod kursorem;
- **OLED**: czysta czerń.

Kolory statusów i wykresów są wspólne dla wszystkich motywów.

**Bajery** to eksperymentalny pakiet animacji i efektów (domyślnie wyłączony). Jeden przełącznik włącza całość, a pod nim każdy efekt da się wyłączyć osobno. Skrót **Alt+B** na każdej stronie pozwala szybko porównać wygląd z efektami i bez nich. Efekty wyzwalane zdarzeniem (ukończenie serii, ocena 10, intro, easter eggi) mają w ustawieniach przycisk „Pokaż”. Gdy system prosi o ograniczenie animacji, efekty ruchu się wyłączają; da się to obejść zaznaczeniem pod przełącznikiem.

Efekty w grupach:
- **Przejścia:** płynne przejścia między stronami (View Transitions), przelot okładki z karty na stronę anime, kołowa zmiana motywu, wjazd przy przewijaniu, tytuły dekodowane z katakany.
- **Kolor:** strona anime i jej przyciski w kolorze okładki, poświata okładek, zorza w tle, ziarno filmowe.
- **Karty:** przechył 3D, holograficzna folia na ulubionych, błysk, reflektor pod kursorem.
- **Reakcje:** figury szachowe przy ukończeniu (większy pokaz przy 1., 10., 25., 50., 100.), gwiazdy przy ocenie 10, licznik „+1” jak odometr, odliczane liczby w statystykach, fala po kliknięciu.
- **Nawigacja:** pasek przewinięcia, paralaksa banera, przesuwany wskaźnik zakładek, żywe logo.
- **NGNL:** pierścień przy liczniku S2, intro raz dziennie, easter eggi, własny kursor.

Wszystko jest w `js/fx.js`, `css/fx.css` i `css/themes.css`, więc efekt, który się nie przyjmie, usuwa się bez ruszania reszty aplikacji.

## Treści 18+

Wyszukiwarka domyślnie pokazuje też anime oznaczone w AniList jako 18+, z odznaką „18+” na okładce. Takie pozycje liczą się normalnie na liście i w statystykach, ale premiery, harmonogram, zapowiedzi, „Do nadrobienia” i powiadomienia zawsze je pomijają. Wyłączysz to w *Ustawienia i kopie → Wyświetlanie*.

## Skąd pochodzą dane

| Funkcja | Źródło | Uwagi |
|---|---|---|
| Wyszukiwarka, szczegóły, okładki, odcinki, długość odcinka, relacje, studia | AniList GraphQL | szuka po tytułach angielskich, japońskich, romaji i synonimach |
| Postacie, aktorzy głosowi, twórcy, rankingi, rozkład ocen | AniList GraphQL | strona anime, strona osoby i statystyki dla nerda |
| Kontynuacje (radar), kolejność oglądania | AniList GraphQL (relacje) | radar raz dziennie, kolejność z pamięcią na 7 dni |
| Kadry, tytuły i daty odcinków | ani.zip (dane TheTVDB), AniList | bez klucza; gdy nie odpowiada, zostają tytuły i daty z MAL |
| Fillery, recapy i oceny odcinków | MyAnimeList przez Jikan | 100 odcinków na zapytanie, pamięć 30 dni (w emisji krócej) |
| Producenci, licencjodawcy, godzina emisji w Japonii | MyAnimeList (Jikan) | uzupełnienie na stronie anime |
| Harmonogram 7 dni, sezony, zapowiedzi | AniList | godziny w Twojej strefie czasowej |
| Newsy NGNL, także japońskie i o merchu | Google News przez rss2json.com | działa od razu, również z dysku; do 10 pozycji na kanał |
| Newsy NGNL: anime, light novel | MyAnimeList (Jikan) | krótkie streszczenie i link do źródła |
| Archiwum newsów z RSS | `data/ngnl-feed.json` z GitHub Actions | opcjonalne; zbiera Google News, Anime News Network i Comic Natalie i trzyma historię do ~13 miesięcy |
| Promo, zwiastuny, grafiki | AniList i MyAnimeList | wideo otwiera się w YouTube |
| Zapowiedź 2. sezonu NGNL | AniList: relacja „sequel” i nowe wpisy serii | licznik sam przełączy się na „Zapowiedziano!” |

Dane odświeżają się same. Emitowane i zapowiedziane tytuły z listy aktualizują się co 45 minut, reszta raz w tygodniu, a newsy NGNL co 3 godziny, gdy aplikacja jest otwarta.

---

## Ograniczenia

- **Gdy AniList ma awarię.** Na górze pojawia się baner z opisem błędu, a aplikacja pokazuje zapisane dane. Najpierw próbuje lżejszej wersji zapytania, a wyszukiwarka przełącza się na wyniki z MyAnimeList. W *Ustawienia i kopie → Test połączenia* sprawdzisz, które zapytania przechodzą, i skopiujesz wynik.
- **Limit AniList.** API działa obecnie w trybie ograniczonym do 30 zapytań na minutę. Aplikacja grupuje zapytania, trzyma wyniki w pamięci podręcznej i sama ponawia po przekroczeniu limitu. Przy bardzo szybkim klikaniu możesz zobaczyć komunikat o chwilowym ograniczeniu.
- **Powiadomienia** działają, gdy aplikacja jest otwarta, także na karcie w tle. Powiadomienia przy zamkniętej aplikacji wymagają serwera push, a tego ten projekt celowo nie ma.
- **Jikan (MyAnimeList) bywa przeciążony.** Newsy, wideo i grafiki z MyAnimeList Jikan pobiera na bieżąco i czasem odpowiada błędem 504. Wtedy wiadomości przychodzą z Google News, a aplikacja sama ponawia Jikan co 3 minuty.
- **Merch.** Żaden sklep nie udostępnia publicznego API z produktami NGNL. Sekcja merchu pokazuje więc ogłoszenia wykryte w newsach i RSS oraz linki do wyszukiwania w sklepach (Allegro, AmiAmi, eBay, Yen Press). Aplikacja nie wymyśla produktów ani cen: gdy źródło nie podaje ceny, widzisz „brak w źródle”.
- **Kategorie newsów** (merch, Blu-ray, light novel, wydarzenia) przypisuje automat na podstawie słów kluczowych, więc zdarzają się pomyłki.
- **Synchronizacja telefon ↔ komputer** wymagałaby backendu. Najprostsza darmowa opcja na przyszłość to Supabase albo Firebase z logowaniem. Na razie służy do tego eksport i import JSON.
- GitHub wyłącza zaplanowane workflow w repozytoriach bez aktywności przez 60 dni. Commity samego feedu zwykle to wystarczają, ale jeśli feed przestanie się aktualizować, uruchom go ręcznie w zakładce *Actions*.

---

## Struktura projektu

```
index.html               szkielet aplikacji
css/app.css              wygląd (ciemny motyw)
css/themes.css           motywy: Ex Machina, Flügel, Werebeast, Zero, OLED
css/fx.css               bajery (efekty za przełącznikiem) i karta „Wygląd” w ustawieniach
js/util.js               formatowanie PL (odmiana, czas, daty), ikony
js/db.js                 zapis listy (IndexedDB), kopie zapasowe, pamięć podręczna
js/api.js                AniList, Jikan, feed; limity i tryb offline
js/library.js            tracker: statusy, odcinki, rewatche, czas, powiadomienia
js/ngnl.js               centrum No Game No Life
js/io.js                 import i eksport JSON, CSV, XML (MAL)
js/charts.js             wykresy statystyk (w tym kalendarz oglądania)
js/extras.js             dane do statystyk dla nerda (obsada, studia, rankingi)
js/nerd.js               statystyki dla nerda
js/person.js             strona aktora głosowego albo twórcy
js/ngnl-timeline.js      oś czasu No Game No Life (dane ze źródłami)
js/watch-order.js        kolejność oglądania serii z relacji AniList
js/episodes.js           odcinki: kadry, fillery, zaznaczanie zakresów, skan fillerów
js/radar.js              radar kontynuacji
js/fx.js                 motywy i bajery: przełączniki, przejścia, efekty, easter eggi
js/ui.js                 komponenty (karty, sekcje, menu statusów)
js/pages/                ekrany: common.js (wspólne), home, list, search, anime,
                         upcoming, ngnl, stats (z historią), settings, lightbox
js/app.js                routing, licznik oczekiwania, odświeżanie w tle
sw.js, manifest          instalacja na telefonie i działanie bez sieci
tools/build-feed.mjs     budowanie feedu RSS (Node 20, bez zależności)
tools/test-browser.mjs   test w Chrome/Edge: zapis w IndexedDB, karty, wszystkie ekrany
tests/                   testy logiki (node --test)
.github/workflows/       harmonogram feedu w GitHub Actions
data/ngnl-feed.json      feed (na start pusty; wypełnia go workflow)
```

## Testy

Bez instalowania czegokolwiek, wystarczy Node 22+:

```
node --test "tests/*.test.mjs"     # logika: czas, rewatche, zakresy odcinków, łączenie kart, eksport/import, zegar NGNL
node tools/test-browser.mjs        # prawdziwa przeglądarka (Chrome albo Edge, bez okna, na czystym profilu)
```

Testy logiki ładują te same pliki z `js/`, których używa aplikacja. Test przeglądarkowy sam uruchamia serwer i przeglądarkę, blokuje sieć do AniList i Jikan i po sobie sprząta. Twojej listy nie dotyka. Po dodaniu nowego pliku JS dopisz go do `index.html` i do listy w `sw.js`; test `tests/files.test.mjs` przypomni, jeśli zapomnisz.

Dane anime pochodzą z [AniList](https://anilist.co) i [MyAnimeList](https://myanimelist.net) (przez [Jikan](https://jikan.moe)). Aplikacja jest do prywatnego, niekomercyjnego użytku.
