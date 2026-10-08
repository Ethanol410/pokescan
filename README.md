# PokéScan

Web app pour téléphone : tu vises une carte Pokémon (française), elle la reconnaît à son image et affiche son prix Cardmarket, l'évolution sur 30 jours, et te dit si le prix du vendeur est une bonne affaire. Pensée pour les braderies : on enchaîne les cartes sans toucher l'écran.

**Appli en ligne : https://pokescan-gamma.vercel.app**

## Installer sur le téléphone

1. Ouvre https://pokescan-gamma.vercel.app et autorise la caméra.
2. Ajoute-la à l'écran d'accueil :
   - **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
   - **Android (Chrome)** : menu ⋮ → *Installer l'application*.
3. Ouvre-la une première fois en Wi-Fi : la base d'images des cartes (environ 6 Mo) et le module de lecture des numéros se téléchargent et restent sur le téléphone. La reconnaissance marche ensuite sans réseau (il en faut juste pour le prix).

## Utilisation

1. Tiens la carte **immobile dans le cadre**, en le remplissant. Les coins passent au jaune quand l'appli analyse.
2. Dès que la carte est reconnue : **bip**, coins verts, et une **bande** apparaît sous le cadre avec le nom, l'extension et le prix.
3. Passe à la carte suivante : l'appli attend que la carte change avant de scanner à nouveau.

Sur la bande : touche-la pour ouvrir la **fiche complète**, ou touche **+** pour ajouter la carte au lot.

### Les boutons

| Bouton | Ce qu'il fait |
|---|---|
| **Pastille « Auto »** (verte = activée) | Scan automatique en continu (voir « Comment ça marche »). |
| **Gros bouton jaune « Scanner »** | Scan immédiat de ce qui est dans le cadre, sans attendre que la carte soit immobile. Au toucher : flash, ligne de scan et anneau qui tourne jusqu'au résultat. Si la caméra est indisponible, il ouvre l'appareil photo. |
| **Lot · n** | Les cartes ajoutées au lot : valeur totale Cardmarket face au total demandé par le vendeur. Pratique pour un classeur. |
| **Loupe** | Recherche à la main par nom et/ou numéro (ex. `4/102`). |
| **Curseurs** | Réglages : état de la base d'images, mode rafale, bip, clé IA. |
| **Éclair** | Lampe, si le téléphone le permet. À éviter sur les cartes en pochette : le reflet gêne la reconnaissance. |

Sur la fiche d'une carte :
- **Prix demandé par le vendeur** : tape son prix, l'appli répond *bonne affaire* (30 % ou plus sous Cardmarket), *prix correct* ou *trop cher*.
- **Ce n'est pas la bonne carte ?** : ouvre la recherche pour corriger.
- **Dernières ventes et annonces** : liens vers les ventes réussies eBay, Cardmarket, Vinted et Leboncoin, pré-remplis avec la carte.

Réglages utiles : **mode rafale** (bande en bas, activé par défaut ; désactivé, chaque carte ouvre sa fiche complète) et **bip** (l'iPhone ne laisse pas les sites vibrer, le son sert de confirmation).

### Conseils de scan
- Remplis bien le cadre avec la carte, bien droite.
- Évite la lampe et les reflets de pochette ; incline légèrement la carte si besoin.
- Si rien ne se passe après 2-3 secondes, utilise le gros bouton jaune ou la loupe.

## Comment ça marche

Quand la carte est immobile, l'appli essaie dans cet ordre :

| Étape | Méthode |
|---|---|
| 1. Image | L'image de la carte est réduite à une empreinte de 12×16 pixels en couleur, comparée aux empreintes de 18 604 cartes françaises (TCGdex ; image anglaise quand la française manque). Reflets ignorés, plusieurs cadrages essayés. La carte est acceptée si elle est nettement plus proche que toutes les autres, et retrouvée sur deux images (ou une seule si l'écart est très net). Environ 20 ms par image. |
| 2. Rééditions | Si la même illustration existe dans plusieurs extensions, l'appli lit le numéro pour choisir, sinon elle te montre les versions en image. |
| 3. IA (option) | Avec une clé API Anthropic, si l'image ne suffit pas après ~1 s, la photo part à Claude Haiku, qui renvoie nom, numéro et extension. Une seule fois par carte. |
| 4. Numéro | Sinon, Tesseract.js lit le numéro imprimé en bas (`133/128`) ; il est validé dès qu'il est lu deux fois en 8 secondes. Le total (`/128`) désigne l'extension. |
| Prix | API TCGdex (gratuite, sans clé) : Cardmarket en € (mis à jour chaque jour), TCGplayer en $, prix par version (1re édition, reverse…). |
| Hors ligne | Un service worker garde l'appli, la base d'images et les cartes déjà vues ; le lot et la clé restent sur le téléphone. |

### Fiabilité mesurée

- Sur les cartes d'une vraie vidéo de téléphone (Électhor et Ectoplasma-ex de l'extension 30ᵉ Anniversaire, avec reflet de lampe) : toutes les images acceptées donnent la bonne carte, parmi 16 900 cartes ; les images sans carte sont toutes refusées.
- Sur 300 cartes au hasard dégradées volontairement (flou, lumière, reflet, cadrage décalé) : environ 1 erreur pour 300 images, les autres sont reconnues ou refusées (le refus déclenche l'étape suivante).
- Les anciennes cartes au cadre très uniforme (ex. Célébi de Triomphant) passent moins bien par l'image : le numéro ou l'IA prennent le relais.

## Activer l'IA (optionnel)

1. Va sur https://console.anthropic.com, crée un compte et ajoute du crédit (5 € minimum).
2. Dans *API Keys*, crée une clé (elle commence par `sk-ant-`).
3. Dans l'appli : curseurs → colle la clé → *Enregistrer*. L'appli la vérifie.

Coût : environ 1 centime pour 100 scans. La clé reste sur ton téléphone et n'est envoyée qu'à Anthropic. Par sécurité, fixe une limite de dépense mensuelle dans la console.

## Limites connues

- **Prix** : tendance Cardmarket du produit, toutes langues confondues. Une carte FR se vend souvent un peu moins cher : vérifie sur Cardmarket pour une grosse carte.
- **Ventes individuelles** : aucune API gratuite ne les fournit, d'où les liens vers les sites.
- **Cartes absentes de la base d'images** (pas d'image dans TCGdex) : numéro, IA ou loupe.
- **Nouvelles extensions** : la base est recalculée chaque lundi.

## Développement

Site statique, sans build : `index.html`, `app.js`, `match.js`, `sw.js`.

```bash
python3 -m http.server 8000   # puis http://localhost:8000 (la caméra marche sur localhost)
```

**Mettre à jour l'appli** : modifie les fichiers, augmente `VERSION` dans `sw.js` (ex. `pokescan-v8`) pour que les téléphones récupèrent la nouvelle version, puis `git push` sur `main`. Vercel redéploie en moins d'une minute. Sur le téléphone, ferme et rouvre l'appli.

**Base d'images** : construite par la tâche GitHub Actions *Index des cartes* (`.github/workflows/index.yml`), chaque lundi, à chaque modification de `match.js`, ou à la demande (onglet *Actions* → *Index des cartes* → *Run workflow*). Elle lance `tools/build-index.mjs` dans un Chromium headless, qui calcule les empreintes avec le même code que l'appli (`match.js`) et enregistre `index/cards.json` + `index/cards-<version>.bin` (288 octets par carte). En local :

```bash
npm i --no-save playwright && npx playwright install chromium && node tools/build-index.mjs
```

### Fichiers

- `index.html` : interface (styles inclus)
- `app.js` : caméra, scan auto, IA, lecture du numéro, recherche, fiche prix, rafale, lot, réglages
- `match.js` : empreintes d'images et recherche dans la base
- `index/` : base d'images (générée, ne pas modifier à la main)
- `tools/build-index.mjs` + `.github/workflows/index.yml` : construction de la base
- `sw.js` : fonctionnement hors ligne
- `manifest.webmanifest` + `icons/` : installation sur l'écran d'accueil
- `vercel.json` : en-têtes (caméra, cache de la base d'images, pas de cache sur le service worker)

### Héberger ailleurs

Il faut du HTTPS pour la caméra. Autres options gratuites : glisser le dossier sur https://app.netlify.com/drop, ou GitHub Pages (*Settings → Pages → Branch : main / root*).
