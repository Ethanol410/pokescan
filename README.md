# PokéScan

Web app pour téléphone : tu vises une carte Pokémon (française, anglaise ou japonaise), elle la reconnaît à son image grâce à un petit modèle de vision qui tourne sur le téléphone et affiche son prix Cardmarket, l'évolution sur 30 jours, et te dit si le prix du vendeur est une bonne affaire. Pensée pour les braderies : on enchaîne les cartes sans toucher l'écran.

**Appli en ligne : https://pokescan-gamma.vercel.app**

## Installer sur le téléphone

1. Ouvre https://pokescan-gamma.vercel.app et autorise la caméra.
2. Ajoute-la à l'écran d'accueil :
   - **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
   - **Android (Chrome)** : menu ⋮ → *Installer l'application*.
3. Ouvre-la une première fois en Wi-Fi : le modèle de vision et la base des cartes (environ 25 Mo en tout, moins de 10 Mo transférés grâce à la compression), la base d'empreintes (6 Mo) et le module de lecture des numéros se téléchargent et restent sur le téléphone. La reconnaissance marche ensuite sans réseau (il en faut juste pour le prix).
4. Cartes anglaises ou japonaises : *Réglages → Langue des cartes*.

## Utilisation

1. Tiens la carte **immobile dans le cadre**, en le remplissant. Les coins passent au jaune quand l'appli analyse.
2. Dès que la carte est reconnue : **bip**, **vibration**, coins verts, et une **bande** apparaît au-dessus du bouton jaune avec le nom, l'extension et le prix.
3. Passe à la carte suivante : la bande s'efface dès que la carte change, et l'appli scanne la nouvelle.

Sur la bande : touche-la pour ouvrir la **fiche complète**, ou touche **+** pour ajouter la carte au lot (la bande « part » dans le lot).

**Carte introuvable** : si une carte reste immobile 5 secondes sans être reconnue (ou si son numéro n'existe pas dans la base), une bande rouge l'indique, avec un son grave et une vibration « erreur », et un bouton *Chercher à la main*.

### Les boutons

| Bouton | Ce qu'il fait |
|---|---|
| **Pastille « Auto »** (verte = activée) | Scan automatique en continu (voir « Comment ça marche »). |
| **Gros bouton jaune « Scanner »** | Scan immédiat de ce qui est dans le cadre, sans attendre que la carte soit immobile. Au toucher : flash, ligne de scan et anneau qui tourne jusqu'au résultat. Si la caméra est indisponible, il ouvre l'appareil photo. |
| **Lot · n** | Les cartes ajoutées au lot : valeur totale Cardmarket (version et état compris) face au total demandé, et **l'offre à proposer** au vendeur (−25, −35 ou −45 %, arrondie à un prix rond). Pratique pour un classeur. |
| **Loupe** | Recherche à la main par nom et/ou numéro (ex. `4/102`). |
| **Curseurs** | Réglages : état de la base d'images, mode rafale, bip, clé IA. |
| **Éclair** | Lampe, si le téléphone le permet. À éviter sur les cartes en pochette : le reflet gêne la reconnaissance. |

Sur la fiche d'une carte :
- **Version** (quand la carte en a plusieurs) : *Normale*, *Reverse*, *Holo*, 1re édition, sans ombre… Chaque version a son propre prix Cardmarket.
- **État de la carte** : *Parfaite* (prix Cardmarket), *Bon état* (×0,7) ou *Abîmée* (×0,4). L'état choisi est retenu pour les cartes suivantes, pratique en braderie où la plupart des cartes ont été jouées. Le prix de référence, le verdict et la valeur du lot en tiennent compte.
- **Prix demandé par le vendeur** : tape son prix, l'appli répond *bonne affaire* (30 % ou plus sous Cardmarket), *prix correct* ou *trop cher*.
- **Ce n'est pas la bonne carte ?** : ouvre la recherche pour corriger, et note l'erreur sur le téléphone (carte proposée, méthode, petite image, puis la bonne carte une fois trouvée). *Réglages → Erreurs de reconnaissance → Partager* les envoie en fichier, pour améliorer les réglages sur de vrais cas.
- **Dernières ventes et annonces** :
  - **Cardmarket · offres en français** et **toutes les offres** ouvrent directement la fiche de la carte (identifiant Cardmarket fourni par TCGdex). Le prix affiché par l'appli est une moyenne toutes langues ; les offres françaises sont souvent un peu moins chères ;
  - **Ventes eBay récentes · PriceCharting** : prix des dernières ventes eBay, sans compte (recherche par le nom anglais de la carte) ;
  - **eBay** : annonces en cours, moins chères d'abord (le filtre « ventes réussies » d'eBay demande un compte) ;
  - **Vinted** et **Leboncoin**, pré-remplis avec la carte.

### Sans réseau

- La **reconnaissance par l'image** marche sans réseau. Si le prix ne peut pas être chargé, la carte est quand même reconnue (bande ⏳ « prix en attente ») : touche **+** pour l'ajouter au lot, ou retrouve-la dans le lot sous *Scannées sans réseau*. Les prix se complètent tout seuls dès que le réseau revient.
- Réseau faible : si une carte a déjà été chargée, sa copie s'affiche au bout de 3,5 s au plus, et se met à jour en arrière-plan.
- **Préparer une braderie** (réglages) : en Wi-Fi, coche les extensions que tu risques de croiser (celles déjà scannées sont en tête) et télécharge leurs prix (et leurs images) à l'avance. Ensuite, scan et prix marchent sans réseau pour ces cartes, y compris par la lecture du numéro.

Réglages utiles : **mode rafale** (bande en bas, activé par défaut ; désactivé, chaque carte ouvre sa fiche complète), **bip** et **vibrations**. Sur Android, les vibrations passent par le vibreur. Sur iPhone, Safari n'a pas d'API de vibration : l'appli utilise le petit « tic » des interrupteurs iOS (iOS 17.4 ou plus récent), garanti après un toucher, à vérifier pour le scan automatique.

### Conseils de scan
- Tiens la carte bien droite, de préférence en remplissant le cadre (elle est retrouvée même plus petite, mais le numéro se lit mieux de près).
- Évite la lampe et les reflets de pochette ; incline légèrement la carte si besoin.
- Si rien ne se passe après 2-3 secondes, utilise le gros bouton jaune ou la loupe.

## Comment ça marche

Quand la carte est immobile, l'appli essaie dans cet ordre :

| Étape | Méthode |
|---|---|
| 0. Repérage | L'appli cherche la carte dans l'image (le rectangle au format carte dont le contour est le plus net), même si elle ne remplit pas le cadre ou est décalée. Les étapes suivantes travaillent sur la carte seule, sans la main autour. |
| 1. Image | **Modèle de vision** : un petit réseau de neurones (LCNet, 4,7 Mo, environ 30 ms par image) calcule une « signature » de 512 valeurs de la carte repérée, du cadre et du cadre resserré, comparée aux signatures de toutes les cartes de la langue choisie (18 604 en français, 19 732 en anglais, 3 878 en japonais). Le modèle a été réglé pour ignorer les défauts des photos : on lui a montré des dizaines de milliers de photos simulées (perspective, reflets, bandes holo, pochette, flou, lumière, fond) et appris une projection qui les rapproche de l'image d'origine. La carte est acceptée si elle est nettement plus proche que toute carte d'un autre nom, retrouvée sur deux images (ou une seule si l'écart est très net). Tant que le modèle n'est pas chargé, l'ancienne empreinte de 12×16 pixels (`match.js`) prend le relais. |
| 2. Rééditions | Si la même illustration existe dans plusieurs extensions, l'appli lit le numéro pour choisir, sinon elle te montre les versions en image. |
| 3. IA (option) | Avec une clé API Anthropic, si l'image ne suffit pas après ~1 s, la photo part à Claude Haiku, qui renvoie nom, numéro et extension. Une seule fois par carte. |
| 4. Numéro | Sinon, Tesseract.js lit le numéro imprimé en bas (`133/128`) ; il est validé dès qu'il est lu deux fois en 8 secondes. Le total (`/128`) désigne l'extension ; s'il y a deux numéros (ex. `045/128 ★23/30` des cartes 30ᵉ anniversaire), c'est le principal qui compte. Le numéro est lu sur le cadre et, à tour de rôle, sur la carte repérée. |
| 5. Vérification | Le numéro lu est **contrôlé par l'image** : la carte qui porte ce numéro doit être parmi les 50 plus ressemblantes de toute la base, selon le modèle de vision. Une carte qui ne ressemble pas à l'image est refusée : un numéro mal lu (`111/10`, `100/107` au lieu de `100/101`) ne donne plus de fausse carte ni de faux « absente de la base ». |
| 6. Nom (plan B) | Si le numéro lu ne colle pas (un chiffre manqué : `41/146` au lieu de `141/146`, fréquent sur les full art en boîtier), l'appli lit le nom en haut de la carte et cherche, dans les extensions de ce total, la carte de ce nom au numéro voisin ; l'image départage (version normale ou full art), sinon elle te propose les 2-3 versions. |
| Prix | API TCGdex (gratuite, sans clé) : Cardmarket en € (mis à jour chaque jour), TCGplayer en $, prix par version (1re édition, reverse…). |
| Langues | Français, anglais, japonais (réglages) : base de cartes TCGdex, index du modèle de vision et lecture du nom propres à chaque langue. Les cartes japonaises ont moins d'images dans TCGdex (3 878) : le numéro prend plus souvent le relais. |
| Hors ligne | Un service worker garde l'appli, la base d'images, les prix et images des cartes déjà vues ou préparées (caches conservés d'une version à l'autre) ; le lot, les erreurs notées et la clé restent sur le téléphone. |

### Fiabilité mesurée

Sur 146 images de quatre vraies vidéos d'iPhone (Safari, cartes en toploader et en boîtier, holos de l'extension 30ᵉ Anniversaire, full art, anciennes cartes EX ; 14 cartes différentes), avec le code de l'appli :

| | Modèle de vision | Ancienne empreinte |
|---|---|---|
| Bonne carte classée 1re sur 18 604 | **63 %** des images | 6 % |
| Reconnaissance par l'image seule, sans aucune erreur | 35 % des images, 11 cartes sur 14 | 7 % |
| Vérification d'un numéro lu : la bonne carte passe | **83 %** | 73 % |
| … une carte prise au hasard passe | **0,3 %** | 5 % |

Les cartes restantes (holo très brillante sous plastique) passent par la lecture du numéro, vérifiée par le modèle. Le plus fiable reste l'IA (option) pour les cartes abîmées ou très mal éclairées.

## Activer l'IA (optionnel)

1. Va sur https://console.anthropic.com, crée un compte et ajoute du crédit (5 € minimum).
2. Dans *API Keys*, crée une clé (elle commence par `sk-ant-`).
3. Dans l'appli : curseurs → colle la clé → *Enregistrer*. L'appli la vérifie.

Coût : environ 1 centime pour 100 scans. La clé reste sur ton téléphone et n'est envoyée qu'à Anthropic. Par sécurité, fixe une limite de dépense mensuelle dans la console.

## Limites connues

- **Prix** : tendance Cardmarket du produit, toutes langues confondues (aucune API gratuite ne donne le prix des seules cartes françaises). Une carte FR se vend souvent un peu moins cher : le lien *offres en français* les montre.
- **État** : les coefficients (×0,7 bon état, ×0,4 abîmée) sont des ordres de grandeur ; pour une grosse carte, regarde les offres du même état sur Cardmarket.
- **Ventes individuelles** : aucune API gratuite ne les fournit, d'où les liens vers les sites.
- **Cartes absentes de la base d'images** (pas d'image dans TCGdex) : numéro, IA ou loupe.
- **Nouvelles extensions** : la base est recalculée chaque lundi.

## Développement

Site statique, sans build : `index.html`, `app.js`, `vision.js`, `match.js`, `locate.js`, `sw.js`.

```bash
python3 -m http.server 8000   # puis http://localhost:8000 (la caméra marche sur localhost)
```

**Mettre à jour l'appli** : modifie les fichiers, augmente `VERSION` dans `sw.js` (ex. `pokescan-v14`) pour que les téléphones récupèrent la nouvelle version, puis `git push` sur `main`. Vercel redéploie en moins d'une minute. Sur le téléphone, ferme et rouvre l'appli.

**Base d'images** : construite par la tâche GitHub Actions *Index des cartes* (`.github/workflows/index.yml`), chaque lundi, à chaque modification de `match.js`, ou à la demande (onglet *Actions* → *Index des cartes* → *Run workflow*). Elle lance `tools/build-index.mjs` dans un Chromium headless, qui calcule les empreintes avec le même code que l'appli (`match.js`) et enregistre `index/cards.json` (avec le numéro de version de l'algorithme, `algo` : l'appli ignore une base calculée avec un ancien algorithme) + `index/cards-<version>.bin` (288 octets par carte). En local :

```bash
npm i --no-save playwright && npx playwright install chromium && node tools/build-index.mjs
```

**Modèle de vision** : construit par la tâche *Index modèle de vision* (`.github/workflows/emb.yml`, `tools/build_emb.py`). Chaque lundi, elle ajoute les nouvelles cartes aux index `index/fr|en|ja/emb-<version>.bin` (512 octets par carte). Avec l'option *rebuild*, elle réapprend la projection (photos simulées : `tools/bench_aug.py`) et refait le modèle `models/card-<version>.onnx` et tous les index. Le moteur onnxruntime-web est servi par l'appli (`vendor/ort/`, copié par la tâche *Fichiers onnxruntime-web*). Le choix du modèle a été fait avec *Banc d'essai modèles* (`tools/bench_models.py`) : LCNet, EfficientNet-B0, MobileNetV3 et ResMLP-DINO comparés sur les vidéos réelles ; LCNet, le plus petit, était aussi le meilleur.

### Fichiers

- `index.html` : interface (styles inclus)
- `app.js` : caméra, scan auto, IA, lecture du numéro, recherche, fiche prix, rafale, lot, réglages
- `vision.js` : modèle de vision (signature de la photo, recherche dans l'index)
- `models/`, `index/fr|en|ja/` : modèle de vision et index par langue (générés)
- `vendor/ort/` : moteur onnxruntime-web (licence MIT)
- `match.js` : empreintes simples (ancienne méthode, sert de relais) et recherche dans la base
- `locate.js` : repérage de la carte dans l'image
- `index/` : base d'images (générée, ne pas modifier à la main)
- `tools/build-index.mjs` + `.github/workflows/index.yml` : construction de la base d'empreintes simples
- `tools/build_emb.py`, `tools/bench_aug.py`, `tools/bench_models.py` + `.github/workflows/emb.yml`, `bench.yml`, `vendor.yml` : modèle de vision
- `sw.js` : fonctionnement hors ligne
- `manifest.webmanifest` + `icons/` : installation sur l'écran d'accueil
- `vercel.json` : en-têtes (caméra, cache de la base d'images, pas de cache sur le service worker)

### Héberger ailleurs

Il faut du HTTPS pour la caméra. Autres options gratuites : glisser le dossier sur https://app.netlify.com/drop, ou GitHub Pages (*Settings → Pages → Branch : main / root*).
