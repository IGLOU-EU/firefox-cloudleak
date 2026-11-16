# Cloud Leak

[English](README.en.md)

`firefox-cloudleak` est le nom de code du dépôt.

Quand vous naviguez, une partie de ce que vous envoyez et lisez passe par des intermédiaires comme Cloudflare, Akamai ou Imperva, qui déchiffrent le trafic, et rien dans le navigateur ne vous le dit. Cette extension Firefox le montre pendant que vous naviguez : quand vos données passent par l'un d'eux, ce qu'il peut en apprendre, et, sur une carte, de quels fournisseurs et de quels pays dépendent les sites que vous utilisez.

## Promesses

1. **Tout reste sur votre ordinateur.** L'extension n'envoie rien à personne et ne télécharge aucune liste. Les listes de fournisseurs sont livrées dans l'extension et ne changent qu'avec une nouvelle version. Sa seule activité réseau consiste à redemander au résolveur DNS de Firefox lui-même un nom que la page vient de résoudre, parce que Firefox ne la laisse pas lire la réponse gardée en cache pour la page ([bug 2051290](https://bugzilla.mozilla.org/show_bug.cgi?id=2051290)).
2. **Aucune adresse n'est gardée, sauf si vous activez l'enregistrement.** Seules des statistiques agrégées sont conservées, par site, méthode, type de requête, fournisseur et niveau, avec le jour où elles ont commencé, jamais l'heure, ainsi que la liste des sites que vous lui demandez d'ignorer. Un site est le domaine enregistrable d'une adresse, comme `legifrance.gouv.fr`, et rien d'autre d'une adresse n'est gardé, sauf si vous activez l'enregistrement des adresses dans les préférences, désactivé par défaut. Alors, et seulement pour les requêtes des niveaux que vous choisissez, le niveau 4 seul ou les niveaux 3 et 4, hors des fenêtres privées, elle garde leur adresse réduite : le schéma, l'hôte, le port, le chemin et les noms des paramètres de l'adresse, jamais leurs valeurs, ni le fragment, ni un nom d'utilisateur ou un mot de passe, comme `https://cdn.example.net/assets/app.css?v=…&token=…`. Pour chaque site, fournisseur, couleur et niveau, méthode et type de requête, elle garde les adresses distinctes, les plus récentes d'abord et jamais avec une heure, jusqu'au nombre que vous réglez, 100 par défaut, sans maximum. Elles sont purgées avec les statistiques de leur site, et toutes d'un coup quand vous désactivez l'enregistrement.
3. **Elle n'affirme jamais plus qu'elle n'observe.** Quand elle ne peut pas savoir, elle le dit, et un doute n'est jamais tranché du côté rassurant.
4. **Elle ne ralentit jamais votre navigation.** Elle observe les requêtes sans jamais les retenir.

Ces promesses sont les règles de conception du projet, dont la formulation qui fait foi se trouve, en anglais, dans [CONTRIBUTING.md](CONTRIBUTING.md#design-rules), avec ce que l'extension fait des valeurs de cookies que Firefox lui transmet.

## État

En construction. L'icône de la barre d'outils montre, pour chaque onglet, si ses requêtes passent par un fournisseur connu, à quel niveau de fuite et si le déchiffrement est prouvé : le nuage prend la couleur de la requête la plus grave, le badge compte les requêtes de l'onglet de cette couleur et de ce niveau, avec un + au-delà de 99, et l'infobulle compte les requêtes de l'onglet à chaque niveau, puis dit ce que voit le fournisseur de la plus grave, avec une ligne de plus quand une requête a porté un cookie du site ou un en-tête `Authorization` en passant par un fournisseur, et une autre quand l'une d'elles appartenait à une protection anti-robot, chacune au conditionnel sauf si le déchiffrement d'une telle requête a été prouvé. Tant que l'extension n'a pas l'accès à tous les sites, chaque onglet d'un site web dit que sa vue est partielle, de même que le mode lecture, qui charge depuis le web les images de l'article, tandis que les autres pages du navigateur (un nouvel onglet, les paramètres, `view-source:`, un fichier local ou une page d'extension) ne sont pas des sites et ne le disent jamais. Un onglet le dit aussi, pour une autre raison, quand l'extension a manqué des requêtes de sa page : celles que sert un service worker, ou celles d'une page chargée avant le démarrage de l'extension. Les boutons Retour et Avance affichent de nouveau l'état de la page qu'ils ramènent, et une page atteinte sans aucune requête, comme un fichier local ou une page du navigateur, part neutre. Un lien qui n'ouvre aucune page, comme un téléchargement, laisse l'icône sur la page encore affichée. Un clic sur l'icône ouvre une fenêtre qui dit la même chose de la page affichée, puis compte, par fournisseur et par niveau, toutes les requêtes du site passées par un fournisseur depuis le début des statistiques du site, le site étant le domaine enregistrable de l'adresse de la page, que l'extension demande à Firefox pour un onglet ouvert avant son démarrage. Les statistiques sont gardées sur votre ordinateur jusqu'à ce que vous les purgiez, un site à la fois, par un bouton de cette fenêtre qui purge le site affiché et aucun autre, dont les statistiques repartent alors de la purge, tandis que les autres sites gardent les leurs et leur date de début, ou toutes d'un coup depuis la carte. Les statistiques des fenêtres privées ne durent que jusqu'à la fermeture de la dernière fenêtre privée, comme la session privée de Firefox, et s'affichent à part : dans une fenêtre privée, le même bouton purge les statistiques du site dans la session privée et laisse intactes ses statistiques gardées. Une page du navigateur, ou un site que l'extension ne connaît pas, n'a rien à purger et ne montre pas ce bouton. La même fenêtre ignore le site affiché, après une question, puisque l'ignorer purge ses statistiques, sauf dans une fenêtre privée, pour qu'aucun site visité en privé n'entre dans la liste des sites ignorés, gardée sur votre ordinateur. La fenêtre d'un site ignoré le dit et ne montre aucune statistique, et son bouton « Ne plus ignorer » le fait regarder de nouveau aussitôt, en fenêtre privée aussi. Un point d'interrogation dans un cercle, en haut à droite de la fenêtre et de la carte, ouvre par-dessus une aide qui explique en mots simples pourquoi il importe qu'un fournisseur se trouve entre vous et un site, ce que veut dire chaque niveau et ce que prouvent l'orange et le rouge. Un engrenage en haut de la fenêtre ouvre les préférences de l'extension, dans son onglet du gestionnaire de modules complémentaires : la liste des sites ignorés, chacun avec un bouton qui le fait regarder de nouveau, et un champ qui ajoute un site désigné par un hôte, un hôte et son port, ou l'adresse d'une page, et qui montre le site obtenu pendant la saisie. Un site est gardé sous la forme de son domaine enregistrable. Une fois un site ignoré, aucune de ses requêtes n'est regardée, y compris celles de ses pages chargées depuis d'autres hôtes, ses statistiques et leur date de début sont purgées, session privée comprise, et chaque onglet qui le montre passe aussitôt au nuage neutre, sans badge, avec « Site ignoré » pour infobulle. Le regarder de nouveau fait repartir ses statistiques de zéro, à partir de ce jour, et ses pages encore ouvertes disent qu'elles ont manqué des requêtes jusqu'à ce qu'elles changent de page. Le bouton « Voir la carte » de la fenêtre ouvre la carte dans un onglet de la même fenêtre, toujours sur l'ensemble : les sites à gauche, du plus grave au moins grave, sous un intitulé pour la catégorie de leur requête la plus grave, un site bleu en point et un site rouge ou orange en nuage de l'icône, les fournisseurs à droite avec le drapeau emoji du pays au droit duquel ils sont soumis, et un lien entre un site et chacun de ses fournisseurs, de la couleur de la catégorie la plus grave du couple, d'autant plus épais que son niveau est élevé, et en tirets quand le déchiffrement n'est pas prouvé, le bleu restant en trait plein. Au-delà de trois, les sites bleus qui passent par les mêmes fournisseurs forment une seule ligne. Un clic sur un site, un fournisseur ou un lien en donne le détail dans le panneau de droite, qui sinon donne la vue d'ensemble. Un champ garde les sites dont le nom contient ce qui est saisi, et un clic sur une ligne de la vue d'ensemble limite la carte aux liens d'un fournisseur ou d'une catégorie, ou aux fournisseurs d'un pays, une limite par liste, chacune montrée en puce, toutes combinées avec la recherche, la vue d'ensemble comptant alors ce que garderait un clic sur chaque ligne, et les fournisseurs restés sans lien quittant la colonne. La carte redemande les statistiques chaque fois que son onglet revient à l'écran. Sa seule action, « Tout purger », purge toutes les statistiques gardées après une question, et les statistiques repartent alors de ce jour pour chaque site, tandis que les sites ignorés restent ignorés. Depuis une fenêtre privée, la carte montre et purge les statistiques de la session privée seulement. Sous les sites ignorés, les préférences activent l'enregistrement des adresses réduites des requêtes, comme le décrit la promesse 2, pour le niveau 4 seul ou pour les niveaux 3 et 4, avec le nombre d'adresses gardées pour chaque ligne, 100 par défaut et sans maximum, et revenir à « Aucune » purge toutes les adresses gardées après une question. Les adresses sont purgées avec les statistiques de leur site, et ce que des réglages plus étroits excluent disparaît aussitôt. Dans le panneau d'un site sur la carte, la ligne d'une méthode et d'un type qui a des adresses gardées porte un triangle, et un clic déplie la liste de ses adresses par ordre alphabétique, douze visibles à la fois, avec leur nombre et l'indication que la limite est atteinte, le cas échéant. Un clic sur une adresse la copie dans le presse-papiers. Rien n'est enregistré, et aucune adresse n'est montrée, dans une fenêtre privée. Les données des fournisseurs couvrent Cloudflare, Akamai, Amazon CloudFront, Fastly, Imperva, Radware et OVHcloud CDN, avec des plages d'adresses IP pour Cloudflare, CloudFront, Fastly et Imperva seulement, puisque Akamai, Radware et OVHcloud ne publient aucune liste qui couvre les adresses de leurs serveurs de bordure.

## Compiler, tester et lancer

L'extension prend en charge Firefox et LibreWolf, en version 153 ou ultérieure. Sa compilation demande Node.js 22 ou ultérieur.

Installez les versions exactes des dépendances, celles du fichier de verrouillage :

```sh
npm ci
```

Compilez l'extension dans `dist/` et empaquetez-la sous `web-ext-artifacts/firefox-cloudleak-<version>.xpi` :

```sh
npm run build
```

Lancez les tests, qui n'ont besoin d'aucun navigateur :

```sh
npm test
```

Pour l'essayer dans Firefox, après une compilation, lancez Firefox avec un profil temporaire où l'extension est installée :

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

Ce programme est un logiciel libre : vous pouvez le redistribuer et le modifier selon les termes de la GNU General Public License publiée par la Free Software Foundation, soit la version 3 de la licence, soit (à votre choix) toute version ultérieure. Voir [LICENSE](LICENSE).
