# LucasBombero

Ayuda al estudio a Lucas para su oposición a bombero.

## Simulador del callejero de Bombers València

Aplicación web (HTML + JavaScript, sin servidor) que pregunta calles de València al azar. Para cada
calle hay que marcar el **parque** que le corresponde y el parque que **coopera**. Si la respuesta es
incorrecta, muestra la correcta con la zona y un mapa de situación.

- Tandas de 10, 20 o 50 calles. Primero salen las que aún no se han preguntado, para recorrer el callejero completo.
- Modo «Solo las que has fallado» y botón para repetir los fallos de la tanda.
- Filtro por parque principal.
- Las calles que cambian de zona a lo largo de su recorrido se preguntan con número de portal
  (p. ej. «Avinguda Pérez Galdós, nº 90») y la corrección muestra la tabla de tramos.
- El progreso se guarda en el propio navegador (localStorage).

### Uso

Abrir `index.html` a través de un servidor web; con `file://` el navegador no deja cargar
`data/calles.json`. En local:

```bash
python3 -m http.server 8000
# http://localhost:8000
```

Para publicarla con GitHub Pages: *Settings → Pages → Build and deployment → Deploy from a branch*,
rama `main` y carpeta `/ (root)`.

### Datos

| Fichero | Origen |
|---|---|
| `data/zonificacion_parques.kml` | Mapa «Zonificación por Parques» de Google My Maps: 11 zonas con los campos *Parque* y *Coopera* |
| `data/calles.json` | Generado por `tools/build_data.py` a partir del KML y de los datos abiertos del Ajuntament de València (geoportal, capas «Ejes de calle» y «Vías») |

Cómo se asigna cada calle a una zona (`tools/build_data.py`):

1. Cada tramo de calle del callejero municipal tiene el rango de portales de cada acera.
   Se evalúa cada acera 12 m a su lado del eje y se mira en qué zona cae. Así, si una calle hace
   de frontera entre dos zonas, cada acera queda en la que le corresponde.
2. Si todas las aceras numeradas de una calle están en la misma zona, la pregunta es solo por la calle.
3. Si no, se pregunta por un número de portal concreto. Se descartan los números que los datos
   sitúan a la vez en dos zonas.
4. Las vías sin numeración se asignan a una zona si al menos el 90 % de su eje cae en ella. Las demás
   se excluyen (puentes sobre el Túria, V-15, V-30, etc.; la lista queda en `excluidas` dentro del JSON).

Para regenerar los datos (por ejemplo, si cambia el mapa: se vuelve a exportar a KML, **desmarcando**
«Mantener los datos sincronizados», y se sustituye `data/zonificacion_parques.kml`):

```bash
pip install -r tools/requirements.txt
python3 tools/build_data.py
```

Leaflet 1.9.4 (licencia BSD-2) va incluido en `vendor/leaflet`. El fondo del mapa es de OpenStreetMap.
