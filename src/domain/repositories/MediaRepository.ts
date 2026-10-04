export interface MediaRepository {
  /**
   * URL temporal (firmada) para descargar una imagen del bucket privado.
   * La LLAVE estable de la imagen es `path`; la URL caduca y cambia en cada firma.
   */
  getSignedUrl(path: string): Promise<string>;
}
