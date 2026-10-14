// Categorías de los invitados. Lo usan el panel (navegador) y el servidor
// (para validar), así que solo hay que tocarlas aquí.
(function (raiz) {
  const CATEGORIAS = {
    invitadoPor: ['Ignacio', 'Ines', 'Ambos'],
    grupos: [
      'Familia directa',
      'Amigos Gozadera',
      'Amigos Madrid & Mix',
      'Amigos Panda de Cabrones',
      'Amigos Pamplona',
      'Amigos Bunga & Soto',
      'Invitados Padres',
      'Primos Abaurre',
      'Primos Montes',
      'Primos 2º',
      'Tios 2º',
      'Tios Abaurre',
      'Tios Montes',
      'Trabajo',
      'Amigos ETSI',
      'Amigos Equipo',
      'Amigos Mix',
      'Amigos New Crew',
      'Amigos Tocina',
      'Amigos Yuca y amiguis',
      'Primos Caballos',
      'Primos Torroba',
      'Tios Caballos',
      'Tios Torroba'
    ]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CATEGORIAS;
  else raiz.CATEGORIAS = CATEGORIAS;
})(this);
