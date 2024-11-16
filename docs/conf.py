# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information

project = 'GridTracker2'
copyright = '%Y, GridTracker.org'
author = "Stephen “Tag” Loomis N0TTL\n Henry “atouk” Forte N2VFL\n And the GridTracker.org team"
version = '2.24.1115.0'

# -- General configuration ---------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#general-configuration

extensions = ['myst_parser']

templates_path = ['_templates']
exclude_patterns = ['_build', 'Thumbs.db', '.DS_Store']
myst_heading_anchors = 7


# -- Options for LaTeX output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-latex-output

latex_logo = 'img/GridTracker_logo.png'
latex_engine = "xelatex"
latex_elements = {
    # Fix Unicode handling by disabling the defaults for a few items
    # set by sphinx
    'inputenc': '',
    'utf8extra': '',
}
latex_documents = [
    ('index',
    'GridTracker2.tex',
    'GridTracker2',
    'Stephen Loomis N0TTL\\and Henry Forte N2VFL\\and Matthew Chambers NR0Q\\and Sebastian Delmont KI2D\\and Christian Bayer WA4YA\\and Paul Traina K6PST\\and Jon Agliss KF5QHQ\\and Beau Gunderson N7YHF\\and Jonathan Fick KE0YBL\\and Florian Wolters DF2ET\\and GridTracker.org',
    'manual')
]

# -- Options for HTML output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-html-output

html_title = 'GridTracker 2'
html_logo = 'img/GridTracker_logo.png'
html_theme = 'alabaster'
# html_static_path = ['_static']
html_sidebars = 'localtoc.html'
html_show_copyright = True
html_last_updated_fmt = ""
html_last_updated_use_utc = True

