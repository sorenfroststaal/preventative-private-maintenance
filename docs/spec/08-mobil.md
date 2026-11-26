# 08 Mobil (iPhone) på det lokale netværk

PPM kan bruges fra en iPhone som en app på hjemmeskærmen, når telefonen er på samme netværk som computeren. Intet sendes til internettet eller en sky; telefonen taler direkte med computeren.

## Server

- Desktopappen starter en lokal server, når brugeren slår **Mobiladgang** til under Indstillinger. Den er slået fra som standard, og valget huskes i arkivet.
- Serveren MÅ kun svare forbindelser fra lokale adresser (loopback, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, link-local og IPv6 ULA). Den laver ingen udgående kald.
- Al forretningslogik går gennem core, som i desktopappen. Ændringer auditeres med den parrede brugers id.
- Serveren SKAL bruge HTTPS. Computeren laver sin egen certifikatudsteder (CA) og et servercertifikat for sine lokale adresser, som opfylder iOS' krav (SHA-256, RSA ≥ 2048, subjectAltName, serverAuth, højst 825 dage). CA'ens private nøgle ligger i appens konfigurationsmappe, ikke i arkivet. En separat HTTP-port må kun udlevere CA-certifikatet og en vejledning.

## Parring

- Telefonen får adgang med en engangskode på 6 tegn, som vises i desktopappen. Koden gælder 10 minutter og annulleres efter 5 forkerte forsøg.
- Koden byttes til en nøgle, som telefonen sender med hvert kald. Kun SHA-256-hashes af kode og nøgle gemmes. En telefon handler som den bruger, der lavede koden, og kan fjernes fra listen over parrede telefoner.

## Mobilappen

- Appen åbnes fra hjemmeskærmen i fuld skærm (web app manifest og iOS-metadata) og følger lys/mørk tilstand.
- Indhold i første version: overblik (forfaldne og kommende opgaver med *udført*, udløber snart, dagens og morgendagens ret, udlån med *afleveret*), kalender som dagsliste, ugens madplan og indkøbsliste med afkrydsning, genstande med fotos og fakta, søgning, og kamera til kvitteringer og fotos (lander i Dokumenter eller på genstanden).
- Telefonen kan også oprette og rette genstande, tilføje billeder fra kamera eller fotobibliotek til en genstand, låne ting ud, registrere og rette gaver og oprette personer uden for husstanden (fanen *Folk*). Serveren skriver kun de felter, appen viser, og går gennem core. Arkivering, sletning og personer i husstanden håndteres på computeren.
- Helbredsdata vises ikke på telefonen, og dokumenter koblet til helbredsdata kan ikke hentes derfra.
