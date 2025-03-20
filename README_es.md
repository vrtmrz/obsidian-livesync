<!-- For translation: 20240227r0 -->
# Self-hosted LiveSync
[Documentación en inglés](./README_ja.md) - [Documentación en japonés](./README_ja.md) - [Documentación en chino](./README_cn.md).

Self-hosted LiveSync es un plugin de sincronización implementado por la comunidad, disponible en todas las plataformas compatibles con Obsidian y utiliza CouchDB o Almacenamiento de Objetos (por ejemplo, MinIO, S3, R2, etc.) como servidor.

![Demostración de Obsidian Live Sync](https://user-images.githubusercontent.com/45774780/137355323-f57a8b09-abf2-4501-836c-8cb7d2ff24a3.gif)

Nota: Este plugin no puede sincronizarse con el "Obsidian Sync" oficial.

## Características

- Sincroniza bóvedas de manera eficiente con menos tráfico.
- Buen manejo de modificaciones en conflicto.
  - Fusión automática para conflictos simples.
- Uso de soluciones de código abierto para el servidor.
  - Pueden usarse soluciones compatibles.
- Soporte de cifrado de extremo a extremo.
- Sincronización de configuraciones, fragmentos, temas y complementos a través de [Sincronización de personalización \(Beta\)](#customization-sync) o [Sincronización de archivos ocultos](#hiddenfilesync)
- WebClip de [obsidian-livesync-webclip](https://chrome.google.com/webstore/detail/obsidian-livesync-webclip/jfpaflmpckblieefkegjncjoceapakdf)

Este plugin puede ser útil para investigadores, ingenieros y desarrolladores que necesitan mantener sus notas totalmente autoalojadas por razones de seguridad, o para aquellos que deseen tener la tranquilidad de saber que sus notas son totalmente privadas.

>[!IMPORTANTE]
> - Antes de instalar o actualizar este plugin, realice un respaldo de su bóveda.
> - No active este plugin junto con otra solución de sincronización al mismo tiempo (incluyendo iCloud y Obsidian Sync).
> - Este es un plugin de sincronización, no una solución de respaldo. No confíe en él para realizar respaldos.

## Cómo usar

### Configuración en 3 minutos - CouchDB en fly.io

**Recomendado para principiantes**

[![Configuración de LiveSync en Fly.io 2024 usando Google Colab](https://img.youtube.com/vi/7sa_I1832Xc/0.jpg)](https://www.youtube.com/watch?v=7sa_I1832Xc)

1. [Configurar CouchDB en fly.io](docs/setup_flyio_es.md)
2. Configurar el plugin en [Configuración rápida](docs/quick_setup_es.md)

### Configuración manual

1. Configurar el servidor
   1. [Configurar CouchDB en fly.io](docs/setup_flyio_es.md)
   2. [Configurar su CouchDB](docs/setup_own_server_es.md)
2. Configura el plugin en [Configuración rápida](docs/quick_setup_es.md)

> [!CONSEJO]
> Actualmente, fly.io ya no es gratuito. Afortunadamente, aunque hay algunos problemas, aún podemos usar IBM Cloudant. Aquí está como [Configurar IBM Cloudant](docs/setup_cloudant.md). ¡Se actualizará pronto!


## Información en la barra de estado

El estado de sincronización se muestra en la barra de estado con los siguientes iconos.

-   Indicador de actividad
    -   📲 Solicitud de red
-   Estado
    -   ⏹️ Detenido
    -   💤 LiveSync activado. Esperando cambios
    -   ⚡️ Sincronización en progreso
    -   ⚠ Ocurrió un error
-   Indicador estadístico
     -   ↑ Chunks y metadatos subidos
     -   ↓ Chunks y metadatos descargados
-   Indicador de progreso
     -   📥 Elementos transferidos sin procesar
     -   📄 Operación de base de datos en curso
     -   💾 Procesos de escritura en almacenamiento en curso
     -   ⏳ Procesos de lectura en almacenamiento en curso
     -   🛫 Procesos de lectura en almacenamiento pendientes
     -   📬 Procesos de lectura en almacenamiento por lotes
     -   ⚙️ Procesos de almacenamiento de archivos ocultos en curso o pendientes
     -   🧩 Chunks en espera
     -   🔌 Elementos de personalización en curso (Configuración, fragmentos y plugins)

Para prevenir la corrupción de archivos y bases de datos, antes de detener Obsidian espere hasta que todos los indicadores de progreso hayan desaparecido (el plugin también intentará reanudar, sin embargo). Especialmente en caso de que haya eliminado o renombrado archivos.


## Consejos y Solución de Problemas
Si tienes problemas para hacer funcionar el plugin, consulta: [Consejos y solución de problemas](docs/troubleshooting_es.md).

## Agradecimientos

El proyecto ha progresado y mantenido en armonía gracias a:
- Muchos [Colaboradores](https://github.com/vrtmrz/obsidian-livesync/graphs/contributors)
- Muchos [Patrocinadores de GitHub](https://github.com/sponsors/vrtmrz#sponsors)
- Programas comunitarios de JetBrains / Soporte para Proyectos de Código Abierto <img src="https://resources.jetbrains.com/storage/products/company/brand/logos/jetbrains.png" alt="JetBrains logo." height="24">

Que aquellos que han contribuido sean honrados y recordados por su amabilidad y generosidad.

## Licencia

Licenciado bajo la Licencia MIT.
