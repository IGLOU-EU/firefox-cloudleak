# Cloud Leak

Available in [English](README.en.md)

Quand vous naviguez, une partie de ce que vous envoyez et lisez passe par des intermédiaires comme Cloudflare, Akamai ou Imperva, qui peuvent lire votre trafic. Cette extension Firefox a pour but de rendre plus visible l'ampleur du problème, en mettant en avant les données qui passent par l'un d'eux, ce qu'il peut en apprendre, de quels fournisseurs et de quels pays dépendent les sites que vous utilisez.

## Règles du projet

1. **Tout se passe en local.** L'extension n'envoie rien à personne et ne télécharge aucune liste. Seule exception, due à un [bug passager de Firefox](https://bugzilla.mozilla.org/show_bug.cgi?id=2051290) : elle redemande au résolveur DNS du navigateur un nom que la page vient de résoudre. Les listes de fournisseurs sont livrées dans l'extension et ne changent qu'avec une nouvelle version.
2. **Aucun historique.** Vous conservez seulement des statistiques agrégées, par site, méthode, type de requête, fournisseur et niveau. Une option d'enregistrement partiel des adresses est disponible dans les préférences, pour une mise en contexte de l'usage du service tiers.
3. **Pas d'affirmations hâtives.** Le niveau dit ce qui passe par le fournisseur et, quand c'est sensible, la couleur dit s'il est prouvé qu'il le lit : rouge si oui, orange sinon.

Ce sont les règles de base pour la conception de ce projet, dont vous trouverez plus de détails dans [CONTRIBUTING.md](CONTRIBUTING.md#design-rules), avec ce que l'extension fait des valeurs de cookies que Firefox lui transmet.

## Utilisation

L'icône de la barre d'outils prend la couleur du niveau le plus élevé de l'onglet et affiche le nombre de requêtes qui correspondent, ou un `+` s'il y en a trop. Sa fenêtre détaille les types de requêtes, et permet de purger ses statistiques ou d'ignorer le site.

Une carte relie l'ensemble des sites utilisant ces services à leurs fournisseurs et au pays dont dépendent les données transitant par chacun. En navigation privée, rien n'est gardé après la fermeture de la dernière fenêtre privée.

L'extension ne connaît pas tous les fournisseurs, et bien qu'elle tente de deviner, il est impossible d'avoir une vision exhaustive. Quand plusieurs intermédiaires se suivent sur le chemin d'une requête, elle n'en nomme qu'un, celui qui l'a le plus sûrement reçue. Une détection dynamique, à activer dans les préférences, suppose un fournisseur absent de sa liste d'après le nom DNS final (CNAME) d'une requête : il s'affiche sous son nom de domaine, avec un ❓ à la place du drapeau, et ce n'est qu'une supposition, qui peut désigner un simple hébergeur. Cependant, cela permet de se faire une idée de la problématique de confidentialité et de souveraineté des données, mais aussi de quels pays peuvent décider du droit d'accéder à un service en ligne.

## Compiler, tester et lancer

L'extension prend en charge Firefox et LibreWolf, en version 153 ou ultérieure. Sa compilation demande Node.js 22 ou ultérieur.

Installez les dépendances du fichier de verrouillage :

```sh
npm ci
```

Compilez l'extension dans `dist/` et empaquetez-la sous `web-ext-artifacts/firefox-cloudleak-<version>.xpi` :

```sh
npm run build
```

Lancez les tests :

```sh
npm test
```

Pour l'essayer après une compilation, lancez Firefox avec un profil temporaire où l'extension est installée :

```sh
npm start
```

`npm start` utilise le `firefox` trouvé dans votre `PATH`. Pour utiliser un autre binaire de Firefox, passez son chemin :

```sh
npm start -- --firefox=/chemin/vers/firefox
```

Pour l'essayer dans LibreWolf, où `npm start` ne parvient pas à se connecter au navigateur, chargez-la à la main après une compilation :

1. Ouvrez `about:debugging` et choisissez « Ce LibreWolf » (la même page affiche « Ce Firefox » dans Firefox).
2. Cliquez sur « Charger un module complémentaire temporaire… » et choisissez `dist/manifest.json`.

L'extension reste installée jusqu'à ce que vous la retiriez ou redémarriez le navigateur.

## Licence

Copyright (C) 2026 Adrien Kara.

Ce programme est un logiciel libre, vous pouvez le redistribuer et le modifier selon les termes de la GNU General Public License publiée par la Free Software Foundation, soit la version 3 de la licence, soit (à votre choix) toute version ultérieure. Voir [LICENSE](LICENSE).
