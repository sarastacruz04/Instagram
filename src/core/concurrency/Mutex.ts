// Mutex asíncrono: garantiza que solo UNA tarea a la vez ejecute la sección crítica.
//
// JS es single-threaded, así que no hay dos líneas ejecutándose EXACTAMENTE a la vez.
// Pero cada `await` cede el control al event loop, y otra tarea puede entrar a la mitad.
// Ejemplo: tarea A hace "BEGIN; INSERT …; await …" y en ese await la tarea B escribe
// en la misma conexión → B queda dentro de la transacción de A. El mutex lo impide.
//
// Implementación: una cadena de Promises. Cada tarea espera a que termine la anterior
// (orden FIFO de llegada), sin bloquear el hilo JS mientras espera.
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    // La cola sigue aunque la tarea falle: un error no debe dejar el mutex trabado para siempre.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
