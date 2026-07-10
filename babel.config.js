module.exports = function (api) {
  api.cache(true);

  // Expo mantém o mesmo código rodando em nativo e web.
  return {
    presets: ['babel-preset-expo'],
  };
};
