import React, { Component } from "react";
import { withStyles } from "@material-ui/core/styles";
import CircularProgress from "@material-ui/core/CircularProgress";
import Card from "@material-ui/core/Card";
import Tabs from "@material-ui/core/Tabs";
import Tab from "@material-ui/core/Tab";
import CardContent from "@material-ui/core/CardContent";
import Snackbar from "@material-ui/core/Snackbar";
import SnackbarContent from "@material-ui/core/SnackbarContent";
import TextField from "@material-ui/core/TextField";
import Typography from "@material-ui/core/Typography";
import Icon from "@material-ui/core/Icon";
import IconButton from "@material-ui/core/IconButton";
import CloseIcon from "@material-ui/icons/Close";
import clsx from "classnames";
import Button from "@material-ui/core/Button";
import LinearProgress from "@material-ui/core/LinearProgress";
import { Title } from "react-admin";
import withCommonStyles from "../utils/with-common-styles";
import {
  getConfig,
  getConfigValue,
  setConfigValue,
  getCategoryDisplayName,
  getCategoryDescription,
  isDescriptor,
  putConfig,
  schemaCategories
} from "../utils/ita";

const styles = withCommonStyles(() => ({}));

function TabContainer(props) {
  return (
    <Typography component="div" style={{ padding: 8 * 3 }}>
      {props.children}
    </Typography>
  );
}

function getDescriptors(schema) {
  const descriptors = [];
  const traverse = (obj, prefix = []) => {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix.concat([k]);
      if (isDescriptor(v)) {
        descriptors.push([path, v]);
      } else {
        traverse(v, path);
      }
    }
  };
  traverse(schema);
  return descriptors;
}

class ConfigurationEditor extends Component {
  state = {
    schema: null,
    config: null,
    category: schemaCategories[0],
    saving: false,
    saved: false,
    saveError: null
  };

  componentDidMount() {
    this.fetchConfigsForCategory();
    //this.setState({ schema: this.props.schema[this.props.category] });
    //getConfig(this.props.service).then(config => this.setState({ config: config }));
  }

  async fetchConfigsForCategory() {
    const servicesForCategory = Object.keys(this.props.schema[this.state.category]);

    const config = {};

    for (const service of servicesForCategory) {
      config[service] = await getConfig(service);
    }

    this.setState({ config });
  }

  handleTabChange(event, category) {
    this.setState({ category, config: null }, () => this.fetchConfigsForCategory());
  }

  onChange(path, ev) {
    const val = ev.target.value;
    const config = this.state.config;
    setConfigValue(config, path, val);
    this.setState({ config: config });
  }

  onSubmit(e) {
    e.preventDefault();

    this.setState({ saving: true }, async () => {
      try {
        for (const [service, config] of Object.entries(this.state.config)) {
          if (Object.keys(config).length > 0) {
            const res = await putConfig(service, config);

            if (res.error) {
              this.setState({ saveError: `Error saving: ${res.error}` });
              break;
            }
          }
        }
      } catch (e) {
        this.setState({ saveError: e.toString() });
      }

      this.setState({ saving: false, saved: true });
    });
  }

  renderSimpleInput(path, descriptor, currentValue) {
    const displayPath = path.join(" > ");
    const inputType = descriptor.type === "number" ? "number" : "text";
    return (
      <TextField
        key={displayPath}
        id={displayPath}
        label={descriptor.name || displayPath}
        value={currentValue || ""}
        onChange={ev => this.onChange(path, ev)}
        helperText={descriptor.description}
        type={inputType}
        fullWidth
        margin="normal"
      />
    );
  }

  renderConfigurable(path, descriptor, currentValue) {
    switch (descriptor.type) {
      case "list":
        return null;
      case "boolean":
      case "string":
      case "number":
      default:
        return this.renderSimpleInput(path, descriptor, currentValue);
    }
  }

  renderTree(schema, category, config) {
    const configurables = getDescriptors(schema[category]).map(([path, descriptor]) =>
      this.renderConfigurable(path, descriptor, getConfigValue(config, path))
    );

    return (
      <form onSubmit={this.onSubmit.bind(this)}>
        {configurables}
        <div>
          {this.state.saving ? (
            <CircularProgress />
          ) : (
            <Button
              onClick={this.onSubmit.bind(this)}
              className={this.props.classes.button}
              variant="contained"
              color="primary"
            >
              Save
            </Button>
          )}
        </div>
      </form>
    );
  }

  render() {
    const { config, category } = this.state;
    const { schema } = this.props;

    return (
      <Card className={this.props.classes.container}>
        <Title title="Server Settings" />
        <CardContent className={this.props.classes.info}>
          <Tabs
            value={this.state.category}
            indicatorColor="primary"
            textColor="primary"
            variant="scrollable"
            scrollButtons="auto"
            onChange={this.handleTabChange.bind(this)}
          >
            {schemaCategories.map(c => (
              <Tab label={getCategoryDisplayName(c)} key={c} value={c} />
            ))}
          </Tabs>
          <TabContainer>
            <Typography variant="body2" gutterBottom>
              {getCategoryDescription(this.state.category)}
            </Typography>
            {schema && config ? this.renderTree(schema, category, config) : <LinearProgress />}
          </TabContainer>
        </CardContent>
        <Snackbar
          anchorOrigin={{ horizontal: "center", vertical: "bottom" }}
          open={this.state.saved || !!this.state.saveError}
          autoHideDuration={10000}
          onClose={() => this.setState({ saved: false, saveError: null })}
        >
          <SnackbarContent
            className={clsx({
              [this.props.classes.success]: !this.state.saveError,
              [this.props.classes.warning]: !!this.state.saveError
            })}
            message={
              <span id="import-snackbar" className={this.props.classes.message}>
                <Icon className={clsx(this.props.classes.icon, this.props.classes.iconVariant)} />
                {this.state.saveError || "Settings saved."}
              </span>
            }
            action={[
              <IconButton key="close" color="inherit" onClick={() => this.setState({ saved: false })}>
                <CloseIcon className={this.props.classes.icon} />
              </IconButton>
            ]}
          ></SnackbarContent>
        </Snackbar>
      </Card>
    );
  }
}

export const ServiceEditor = withStyles(styles)(ConfigurationEditor);
