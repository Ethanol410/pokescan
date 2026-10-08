# PokéScan

Web app à installer sur ton téléphone : tu vises une carte Pokémon, elle affiche son prix Cardmarket, l'évolution sur 30 jours, et te dit si le prix du vendeur est une bonne affaire. Pensée pour les braderies.

**Appli en ligne : https://pokescan-gamma.vercel.app** (déployée sur Vercel depuis ce dépôt : chaque `git push` sur `main` la met à jour automatiquement).

## Héberger ailleurs

La caméra ne fonctionne qu'en **HTTPS**. Autres options gratuites :

### Option A — Netlify Drop (le plus simple)
1. Va sur https://app.netlify.com/drop (crée un compte gratuit si demandé).
2. Glisse-dépose **tout le dossier `PokeScan`** dans la page.
3. Netlify te donne une adresse du type `https://xxx.netlify.app`. Ouvre-la sur ton téléphone.

### Option B — GitHub Pages
1. Crée un dépôt public sur GitHub (ex. `pokescan`) et envoie-y le contenu du dossier.
2. Dans le dépôt : *Settings → Pages → Branch : main / root → Save*.
3. L'adresse est `https://<ton-pseudo>.github.io/pokescan/`.

### Installer sur le téléphone
- **Android (Chrome)** : menu ⋮ → *Ajouter à l'écran d'accueil* / *Installer l'application*.
- **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.

L'appli s'ouvre alors en plein écran comme une vraie appli. Ouvre-la une fois chez toi avec du Wi-Fi : la lecture des numéros se télécharge (environ 10 Mo) et reste ensuite sur le téléphone.

## Utilisation en braderie

- **Scan auto** (pastille « Auto » verte) : tiens la carte dans le cadre, le numéro du bas dans la zone pointillée. La fiche s'ouvre toute seule.
- **Gros bouton jaune** : scan immédiat. Avec une clé IA, c'est le plus fiable.
- **Loupe** : recherche par nom et/ou numéro (ex. `4/102`) si le scan échoue.
- **Prix demandé** : tape le prix du vendeur, l'appli te dit *bonne affaire / correct / trop cher* par rapport à Cardmarket.
- **Lot** : ajoute plusieurs cartes pour voir la valeur totale d'un classeur ou d'un lot.
- **Lampe** : apparaît si ton téléphone la gère (Android surtout).

## Comment ça marche

| Étape | Méthode |
|---|---|
| Lecture | Tesseract.js lit le numéro imprimé en bas (`4/102`) directement sur le téléphone. Gratuit, sans réseau. |
| Identification | Le total (`/102`) désigne l'extension, le premier nombre la carte. Si plusieurs extensions ont le même total, l'appli lit le nom en haut de la carte, sinon elle te montre les candidates. |
| IA (option) | Avec une clé API Anthropic (Réglages), le gros bouton envoie la photo à Claude Haiku, qui renvoie nom + numéro. Moins d'un centime pour 10 scans. |
| Prix | API TCGdex (gratuite, sans clé) : Cardmarket en € (mis à jour chaque jour), TCGplayer en $, prix par version (1re édition…). |
| Ventes | Boutons vers les ventes réussies eBay, Cardmarket, Vinted, Leboncoin, pré-remplis avec la carte. |
| Hors ligne | Un service worker garde l'appli et les cartes déjà vues ; le lot et la clé restent sur le téléphone. |

## Limites connues

- **La lecture locale rate environ une carte sur deux** sur les numéros minuscules ou stylisés (cartes full art, anciennes cartes avec le numéro à droite). Rapproche la carte, évite les reflets, ou utilise l'IA / la loupe. 
- **Prix** : c'est la tendance Cardmarket du produit, toutes langues confondues. Une carte FR se vend souvent un peu moins cher. Vérifie sur Cardmarket pour une grosse carte.
- **Ventes individuelles** : aucune API gratuite ne les fournit, d'où les liens vers les sites.
- **Clé API** : elle reste stockée sur ton téléphone et n'est envoyée qu'à Anthropic. Partager l'adresse de l'appli ne partage pas ta clé. Fixe une limite de dépense sur console.anthropic.com par sécurité.

## Mettre à jour l'appli

Modifie les fichiers, augmente `VERSION` dans `sw.js` (ex. `pokescan-v2`) pour que les téléphones récupèrent la nouvelle version, puis `git push`. Vercel redéploie en moins d'une minute.

## Fichiers

- `index.html` : interface (styles inclus)
- `app.js` : caméra, lecture, recherche, fiche prix, lot, réglages
- `sw.js` : fonctionnement hors ligne
- `manifest.webmanifest` + `icons/` : installation sur l'écran d'accueil
- `vercel.json` : en-têtes (autorisation caméra, pas de cache sur le service worker)
