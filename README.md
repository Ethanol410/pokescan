# PokéScan

Web app pour téléphone : tu vises une carte Pokémon (française), elle affiche son prix Cardmarket, l'évolution sur 30 jours, et te dit si le prix du vendeur est une bonne affaire. Pensée pour les braderies.

**Appli en ligne : https://pokescan-gamma.vercel.app**

## Installer sur le téléphone

1. Ouvre https://pokescan-gamma.vercel.app et autorise la caméra.
2. Ajoute-la à l'écran d'accueil :
   - **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
   - **Android (Chrome)** : menu ⋮ → *Installer l'application*.
3. Ouvre-la une première fois en Wi-Fi : le module de lecture des numéros (environ 10 Mo) se télécharge et reste sur le téléphone.

## Les boutons

| Bouton | Ce qu'il fait |
|---|---|
| **Pastille « Auto »** (verte = activée) | Scan automatique en continu. Sans clé IA : l'appli lit le numéro en bas de la carte et valide dès qu'elle l'a lu deux fois en 8 secondes. Avec une clé IA : dès que la carte reste immobile une seconde, une image part à l'IA, la fiche s'ouvre, puis l'appli attend la carte suivante. |
| **Gros bouton jaune « Scanner »** | Scan immédiat de ce qui est dans le cadre, sans attendre. Au toucher : flash, ligne de scan qui balaie la carte et anneau qui tourne autour du bouton jusqu'au résultat ; le scan auto se met en pause pendant ce temps. Avec une clé IA, il utilise l'IA. Sans clé, il essaie toutes les méthodes de lecture sur l'image et valide dès la première lecture (pas de vote). Si la caméra est indisponible, il ouvre l'appareil photo. Utile quand le mode auto est coupé ou n'arrive pas à valider. |
| **Lot · n** | Les cartes ajoutées avec « Ajouter au lot » : valeur totale Cardmarket face au total demandé par le vendeur. Pratique pour un classeur ou un lot. |
| **Loupe** | Recherche à la main par nom et/ou numéro (ex. `4/102`). |
| **Curseurs** | Réglages : clé IA (l'icône devient jaune quand elle est active). |
| **Éclair** | Lampe, si le téléphone le permet. À éviter sur les cartes en pochette : le reflet cache le numéro. |

Sur la fiche d'une carte :
- **Prix demandé par le vendeur** : tape son prix, l'appli répond *bonne affaire* (30 % ou plus sous Cardmarket), *prix correct* ou *trop cher*.
- **Ce n'est pas la bonne carte ?** : ouvre la recherche pour corriger.
- **Dernières ventes et annonces** : liens vers les ventes réussies eBay, Cardmarket, Vinted et Leboncoin, pré-remplis avec la carte.

### Conseils de scan
- Remplis bien le cadre avec la carte, bien à plat.
- Coupe la lampe et incline légèrement la carte si un reflet passe sur le bas.
- Si rien ne se passe après quelques secondes, utilise le gros bouton jaune ou la loupe.

## Activer l'IA (recommandé)

La lecture gratuite marche bien sur certaines cartes (ex. Célébi 3/102), mais rate souvent les numéros en italique sur fond holographique des cartes récentes. L'IA (Claude Haiku) reconnaît presque toutes les cartes.

1. Va sur https://console.anthropic.com, crée un compte et ajoute du crédit (5 € minimum).
2. Dans *API Keys*, crée une clé (elle commence par `sk-ant-`).
3. Dans l'appli : curseurs → colle la clé → *Enregistrer*. L'appli la vérifie.

Coût : environ 1 centime pour 100 scans. La clé reste sur ton téléphone et n'est envoyée qu'à Anthropic. Par sécurité, fixe une limite de dépense mensuelle dans la console.

## Comment ça marche

| Étape | Méthode |
|---|---|
| Lecture gratuite | Tesseract.js lit le numéro imprimé en bas (`133/128`) directement sur le téléphone, en pleine résolution, avec plusieurs découpages (bande entière, coin gauche, coin droit, négatif). |
| Lecture IA | La photo de la carte (1000 px) part à Claude Haiku, qui renvoie nom, numéro et extension. |
| Identification | Le total (`/128`) désigne l'extension, le premier nombre la carte. Si plusieurs extensions ont le même total, l'appli départage avec le nom, sinon elle te montre les candidates en image. Les extensions du jeu mobile TCG Pocket sont ignorées. |
| Prix | API TCGdex (gratuite, sans clé) : Cardmarket en € (mis à jour chaque jour), TCGplayer en $, prix par version (1re édition, reverse…). |
| Hors ligne | Un service worker garde l'appli et les cartes déjà vues ; le lot et la clé restent sur le téléphone. |

## Limites connues

- **Lecture gratuite** : sur de vraies vidéos de téléphone, elle ne lit le numéro des cartes récentes que sur environ une image sur cinq. Le vote sur plusieurs images compense en partie ; l'IA règle le problème.
- **Prix** : tendance Cardmarket du produit, toutes langues confondues. Une carte FR se vend souvent un peu moins cher : vérifie sur Cardmarket pour une grosse carte.
- **Ventes individuelles** : aucune API gratuite ne les fournit, d'où les liens vers les sites.
- **Promos** sans numéro du type `xx/yyy` (ex. `SVP 050`) : passe par la loupe ou l'IA.

## Développement

Site statique, sans build : `index.html`, `app.js`, `sw.js`.

```bash
python3 -m http.server 8000   # puis http://localhost:8000 (la caméra marche sur localhost)
```

**Mettre à jour l'appli** : modifie les fichiers, augmente `VERSION` dans `sw.js` (ex. `pokescan-v6`) pour que les téléphones récupèrent la nouvelle version, puis `git push` sur `main`. Vercel redéploie en moins d'une minute. Sur le téléphone, ferme et rouvre l'appli.

### Fichiers

- `index.html` : interface (styles inclus)
- `app.js` : caméra, lecture, IA, recherche, fiche prix, lot, réglages
- `sw.js` : fonctionnement hors ligne
- `manifest.webmanifest` + `icons/` : installation sur l'écran d'accueil
- `vercel.json` : en-têtes (autorisation caméra, pas de cache sur le service worker)

### Héberger ailleurs

Il faut du HTTPS pour la caméra. Autres options gratuites : glisser le dossier sur https://app.netlify.com/drop, ou GitHub Pages (*Settings → Pages → Branch : main / root*).
