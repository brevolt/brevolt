# Spike 001 · Contacts change history on macOS (BRV-001)

**Resultado: funciona con limitaciones.** Requisitos: R-BR-1, R-BR-3, R-BR-5.
Código: `spikes/contacts-history/` (SwiftPM, `swift build`). macOS 27 / Swift 6.4, contenedor local "En mi Mac".

## Resumen

| Criterio | Resultado |
|---|---|
| Altas, modificaciones y borrados desde un token guardado | OK: 1 alta + 1 modificación + 1 borrado detectados con `CNChangeHistoryFetchRequest` |
| `transactionAuthor` + `excludedTransactionAuthors` | OK: 1.000 altas visibles sin exclusión, 0 con el autor excluido; un autor distinto sí aparece |
| Lectura completa de 1.000 contactos sintéticos | ~0,024 s (999 contactos, `enumerateContacts` filtrado por grupo, claves: nombre, apellido, teléfonos) |
| Token caducado/inválido | No da error; ver abajo |

Escritura de 1.000 contactos en lotes de 100: ~4–4,4 s.

## Limitaciones

1. **`enumeratorForChangeHistoryFetchRequest:error:` es `NS_SWIFT_UNAVAILABLE`.** Desde Swift no se puede llamar directamente: hace falta un shim Objective-C (`Sources/CHShim`, ~15 líneas) en el mismo paquete SwiftPM.
2. **Token caducado o corrupto: no hay error.** Con un token inventado o vacío la lectura devuelve el historial completo: un `CNChangeHistoryDropEverythingEvent` seguido de todas las altas. Por tanto R-BR-5 se detecta así: si aparece `DropEverythingEvent` → descartar estado incremental y tratar el lote como snapshot completo. No existe un código de error que comprobar.
3. El `currentHistoryToken` se obtiene antes de escribir; el token devuelto por cada lectura (`CNFetchResult.currentHistoryToken`) es el que hay que guardar. Releer desde él devuelve 0 eventos.
4. Con `shouldUnifyResults = true` los eventos vienen ya unificados; los borrados solo traen `contactIdentifier`, no los datos del contacto.
5. Este spike no mide el comportamiento en cuentas iCloud/CardDAV (solo se probó el contenedor local), ni la caducidad real por tiempo/volumen de historial; la caducidad solo se simuló con un token inválido.

## Fragmentos reutilizables

Escritura etiquetada (R-BR-3):

```swift
let r = CNSaveRequest()
r.transactionAuthor = "com.brevolt.bridge"
r.add(contact, toContainerWithIdentifier: containerID)
try store.execute(r)
```

Lectura incremental excluyendo escrituras propias (R-BR-1/3/5):

```swift
let req = CNChangeHistoryFetchRequest()
req.startingToken = savedToken               // nil = desde el principio
req.excludedTransactionAuthors = ["com.brevolt.bridge"]
req.shouldUnifyResults = true
var newToken: NSData?
let events = try CHShim.fetchHistory(store, request: req, outToken: &newToken)
for e in events {
    switch e {
    case let a as CNChangeHistoryAddContactEvent:    /* a.contact */
    case let u as CNChangeHistoryUpdateContactEvent: /* u.contact */
    case let d as CNChangeHistoryDeleteContactEvent: /* d.contactIdentifier */
    case is CNChangeHistoryDropEverythingEvent:      /* token inválido → snapshot completo */
    default: break
    }
}
// guardar newToken solo tras procesar con éxito
```

## Seguridad del spike

Se ejecutó en la cuenta real de raul, solo en el contenedor local "En mi Mac" (se aborta si no existe), con contactos sintéticos `ZZ-BRV-SPIKE`, grupo propio, borrado únicamente por identificador de manifiesto (con doble comprobación del prefijo), escrituras bajo `--allow-write` y sin imprimir datos de contactos. Verificado al terminar: 0 contactos y 0 grupos `ZZ-BRV-SPIKE`.

## Uso

```
swift build
.build/debug/contacts-history containers
.build/debug/contacts-history run --count=1000 --allow-write
.build/debug/contacts-history cleanup --allow-write
```
